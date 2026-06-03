"""
Database migration system. Runs on app startup.
Creates tables and adds columns without losing data.
"""
import sqlite3, logging, os, shutil

log = logging.getLogger("uvicorn.error")

def safe_add_col(con, table, col, ctype):
    try: con.execute(f"ALTER TABLE {table} ADD COLUMN {col} {ctype}"); con.commit()
    except: pass


def _backfill_original_cover_timeline(con):
    """v29 — one-time data backfill.

    Pre-v8.49.3 plants never had their creation photo inserted into the
    plant_photos timeline table — the cover lived ONLY at
    /static/plants/<id>.jpg and updates appended new timeline entries
    without referencing the original.

    v8.49.3 added auto-backfill on the *first post-v8.49.3 Update* but
    GATED on `photo_count == 0` — which already failed for any plant that
    had earlier updates pre-v8.49.3. So those plants still have a gap:
    their first timeline entry is dated after creation, and there's no
    timeline row representing the cover.

    This migration plugs that gap: for every plant whose timeline lacks
    an entry within ~1 hour of plant.added_at, we insert one dated to
    added_at and copy the current cover file into timeline storage.

    Caveat: if the plant already had a post-v8.49.3 Update, the cover
    file has already been overwritten by that update — so the backfilled
    photo is the latest, not strictly the original. We can't recover the
    real original from disk (it's gone). But the user gets timeline
    structure restored either way, and most plants haven't been updated
    yet so this preserves the actual first cover for them.
    """
    plants_img_dir = os.environ.get("PLANTS_IMG_DIR", "/app/frontend/plants")
    timeline_dir = os.path.join(plants_img_dir, "timeline")
    try:
        os.makedirs(timeline_dir, exist_ok=True)
    except Exception:
        return  # disk problems — bail; not worth blocking startup
    backfilled = 0
    for row in con.execute("SELECT id, added_at, added_by FROM plants").fetchall():
        pid = row[0]
        added_at = row[1]
        added_by = row[2]
        cover_path = os.path.join(plants_img_dir, f"{pid}.jpg")
        if not os.path.isfile(cover_path):
            continue
        # Already has a near-creation timeline entry? Skip.
        existing = con.execute(
            """SELECT id FROM plant_photos
               WHERE plant_id=?
                 AND ABS(julianday(taken_at) - julianday(?)) < 0.04
               LIMIT 1""", (pid, added_at)
        ).fetchone()
        if existing:
            continue
        cur = con.execute(
            "INSERT INTO plant_photos (plant_id, caption, taken_at, added_by) VALUES (?, ?, ?, ?)",
            (pid, "", added_at, added_by)
        )
        new_pid = cur.lastrowid
        try:
            shutil.copyfile(cover_path, os.path.join(timeline_dir, f"{new_pid}.jpg"))
            backfilled += 1
        except Exception as e:
            # Roll back the DB row if we couldn't copy the file
            con.execute("DELETE FROM plant_photos WHERE id=?", (new_pid,))
            log.warning(f"v29 backfill: file copy failed for plant {pid}: {e}")
    if backfilled:
        log.info(f"v29 backfill inserted {backfilled} original-cover timeline entries")

DEFAULT_EXERCISES = [
    ("Bench Press", "🪑", "chest", 120),
    ("Squat", "🦵", "legs", 180),
    ("Deadlift", "🏋️", "back", 180),
    ("Overhead Press", "💪", "shoulders", 120),
    ("Barbell Row", "🚣", "back", 90),
    ("Pull-up", "🤸", "back", 90),
    ("Dip", "🤸", "chest", 90),
    ("Bicep Curl", "💪", "arms", 60),
    ("Tricep Extension", "💪", "arms", 60),
    ("Plank", "🧘", "core", 60),
]

def _seed_exercises(con, fid):
    """Seed default catalog of strength exercises for a family. Idempotent."""
    if con.execute("SELECT COUNT(*) FROM exercises WHERE family_id=?", (fid,)).fetchone()[0] > 0:
        return
    for name, emoji, mg, rs in DEFAULT_EXERCISES:
        con.execute(
            "INSERT INTO exercises (family_id,name,emoji,muscle_group,rest_seconds) VALUES (?,?,?,?,?)",
            (fid, name, emoji, mg, rs))

def _migrate_v13_templates(con):
    """Workout templates + started_at/finished_at on workouts."""
    safe_add_col(con, "workouts", "started_at", "TEXT")
    safe_add_col(con, "workouts", "finished_at", "TEXT")
    con.executescript("""
        CREATE TABLE IF NOT EXISTS workout_templates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            family_id INTEGER NOT NULL,
            member_id INTEGER,
            name TEXT NOT NULL,
            notes TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS template_exercises (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            template_id INTEGER NOT NULL,
            exercise_id INTEGER NOT NULL,
            sort_order INTEGER DEFAULT 0,
            notes TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_templates_family ON workout_templates(family_id);
        CREATE INDEX IF NOT EXISTS idx_te_template ON template_exercises(template_id);
    """)
    con.commit()

def _migrate_v12_trainings(con):
    """Add indexes for trainings tables and seed default catalog for existing families."""
    con.executescript("""
        CREATE INDEX IF NOT EXISTS idx_exercises_family ON exercises(family_id);
        CREATE INDEX IF NOT EXISTS idx_workouts_member_date ON workouts(member_id, date DESC);
        CREATE INDEX IF NOT EXISTS idx_workouts_family ON workouts(family_id, date DESC);
        CREATE INDEX IF NOT EXISTS idx_we_workout ON workout_exercises(workout_id);
        CREATE INDEX IF NOT EXISTS idx_ws_we ON workout_sets(workout_exercise_id);
    """)
    for f in con.execute("SELECT id FROM families").fetchall():
        _seed_exercises(con, f[0])
    con.commit()

def _seed_categories(con):
    """Seed default expense/income categories for all existing families."""
    defaults_expense = [("🍔", "Food", 0), ("🏠", "Home / bills", 1), ("🎉", "Entertainment", 2), ("🚕", "Transport", 3), ("🛒", "Shopping", 4), ("💊", "Health", 5), ("📦", "Other", 6)]
    defaults_income = [("💼", "Salary", 0), ("💻", "Freelance", 1), ("🎁", "Gift", 2), ("📦", "Other", 3)]
    fams = con.execute("SELECT id FROM families").fetchall()
    for f in fams:
        fid = f[0]
        existing = con.execute("SELECT COUNT(*) FROM categories WHERE family_id=?", (fid,)).fetchone()[0]
        if existing > 0: continue
        for emoji, name, sort in defaults_expense:
            con.execute("INSERT INTO categories (family_id,name,emoji,type,is_default,sort_order) VALUES (?,?,?,?,1,?)", (fid, name, emoji, "expense", sort))
        for emoji, name, sort in defaults_income:
            con.execute("INSERT INTO categories (family_id,name,emoji,type,is_default,sort_order) VALUES (?,?,?,?,1,?)", (fid, name, emoji, "income", sort))
    con.commit()

def migrate(db_path):
    con = sqlite3.connect(db_path, check_same_thread=False)
    
    # Ensure schema_version exists
    con.execute("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER DEFAULT 0)")
    if not con.execute("SELECT version FROM schema_version").fetchone():
        con.execute("INSERT INTO schema_version VALUES (0)")
        con.commit()
    ver = con.execute("SELECT version FROM schema_version").fetchone()[0]

    # ─── Base tables (always safe with IF NOT EXISTS) ────────────────────
    con.executescript("""
        CREATE TABLE IF NOT EXISTS families (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            invite_code TEXT UNIQUE NOT NULL,
            name TEXT DEFAULT 'My Family',
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS family_members (
            user_id INTEGER PRIMARY KEY,
            family_id INTEGER NOT NULL,
            user_name TEXT,
            emoji TEXT DEFAULT '👤',
            color TEXT DEFAULT '#7c6aef',
            photo_url TEXT,
            tg_chat_id INTEGER,
            theme TEXT,
            joined_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            family_id INTEGER NOT NULL,
            text TEXT NOT NULL,
            assigned_to INTEGER,
            priority TEXT DEFAULT 'normal',
            done INTEGER DEFAULT 0,
            due_date TEXT,
            created_by TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS task_reminders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id INTEGER NOT NULL,
            family_id INTEGER NOT NULL,
            remind_at TEXT NOT NULL,
            sent INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS recurring_tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            family_id INTEGER NOT NULL,
            text TEXT NOT NULL,
            assigned_to INTEGER,
            priority TEXT DEFAULT 'normal',
            rrule TEXT NOT NULL,
            active INTEGER DEFAULT 1,
            last_generated TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS shopping (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            family_id INTEGER NOT NULL,
            item TEXT NOT NULL,
            quantity TEXT,
            bought INTEGER DEFAULT 0,
            added_by TEXT,
            folder_id INTEGER,
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS shopping_folders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            family_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            emoji TEXT DEFAULT '📁',
            sort_order INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            family_id INTEGER NOT NULL,
            text TEXT NOT NULL,
            event_date TEXT NOT NULL,
            end_date TEXT,
            created_by TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS birthdays (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            family_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            emoji TEXT DEFAULT '🎂',
            birth_date TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS birthday_reminders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            birthday_id INTEGER NOT NULL,
            family_id INTEGER NOT NULL,
            days_before INTEGER DEFAULT 0,
            time TEXT DEFAULT '09:00',
            sent_year INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS subscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            family_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            emoji TEXT DEFAULT '💳',
            amount REAL NOT NULL,
            currency TEXT DEFAULT 'EUR',
            amount_eur REAL,
            billing_day INTEGER DEFAULT 1,
            assigned_to INTEGER,
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS subscription_reminders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sub_id INTEGER NOT NULL,
            family_id INTEGER NOT NULL,
            days_before INTEGER DEFAULT 1,
            time TEXT DEFAULT '09:00',
            sent_month TEXT
        );
        CREATE TABLE IF NOT EXISTS subtasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            parent_type TEXT NOT NULL,
            parent_id INTEGER NOT NULL,
            family_id INTEGER NOT NULL,
            text TEXT NOT NULL,
            done INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS cleaning_zones (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            family_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            icon TEXT DEFAULT '🏠',
            assigned_to INTEGER,
            sort_order INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS cleaning_tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            zone_id INTEGER NOT NULL,
            family_id INTEGER NOT NULL,
            text TEXT NOT NULL,
            icon TEXT DEFAULT '🧹',
            assigned_to INTEGER,
            done INTEGER DEFAULT 0,
            reset_days INTEGER DEFAULT 7,
            last_done TEXT
        );
        CREATE TABLE IF NOT EXISTS zone_reminders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            zone_id INTEGER NOT NULL,
            family_id INTEGER NOT NULL,
            remind_at TEXT NOT NULL,
            sent INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS settings (
            family_id INTEGER PRIMARY KEY,
            theme TEXT DEFAULT 'midnight',
            digest_time TEXT DEFAULT '09:00'
        );
        CREATE TABLE IF NOT EXISTS categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            family_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            emoji TEXT DEFAULT '📦',
            type TEXT NOT NULL DEFAULT 'expense',
            is_default INTEGER DEFAULT 0,
            sort_order INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            family_id INTEGER NOT NULL,
            type TEXT NOT NULL DEFAULT 'expense',
            amount REAL NOT NULL,
            currency TEXT DEFAULT 'RSD',
            amount_eur REAL,
            category_id INTEGER,
            description TEXT,
            date TEXT NOT NULL,
            member_id INTEGER,
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS category_limits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            family_id INTEGER NOT NULL,
            category_id INTEGER NOT NULL,
            monthly_limit REAL NOT NULL,
            UNIQUE(family_id, category_id)
        );
        CREATE TABLE IF NOT EXISTS transaction_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            transaction_id INTEGER NOT NULL,
            family_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            quantity INTEGER DEFAULT 1,
            amount REAL NOT NULL DEFAULT 0,
            currency TEXT DEFAULT 'RSD',
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS exercises (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            family_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            emoji TEXT DEFAULT '💪',
            image_url TEXT,
            muscle_group TEXT DEFAULT 'other',
            description TEXT,
            rest_seconds INTEGER DEFAULT 90,
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS workouts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            family_id INTEGER NOT NULL,
            member_id INTEGER NOT NULL,
            date TEXT NOT NULL,
            name TEXT,
            notes TEXT,
            started_at TEXT,
            finished_at TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS workout_templates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            family_id INTEGER NOT NULL,
            member_id INTEGER,
            name TEXT NOT NULL,
            notes TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS template_exercises (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            template_id INTEGER NOT NULL,
            exercise_id INTEGER NOT NULL,
            sort_order INTEGER DEFAULT 0,
            notes TEXT
        );
        CREATE TABLE IF NOT EXISTS workout_exercises (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            workout_id INTEGER NOT NULL,
            exercise_id INTEGER NOT NULL,
            sort_order INTEGER DEFAULT 0,
            notes TEXT
        );
        CREATE TABLE IF NOT EXISTS workout_sets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            workout_exercise_id INTEGER NOT NULL,
            set_number INTEGER NOT NULL,
            reps INTEGER NOT NULL,
            weight REAL NOT NULL DEFAULT 0,
            weight_unit TEXT DEFAULT 'kg',
            notes TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );
    """)
    con.commit()

    # ─── Incremental migrations ──────────────────────────────────────────
    migrations = [
        # v1: ensure columns from v4
        lambda c: [
            safe_add_col(c, "family_members", "emoji", "TEXT DEFAULT '👤'"),
            safe_add_col(c, "family_members", "color", "TEXT DEFAULT '#7c6aef'"),
            safe_add_col(c, "family_members", "photo_url", "TEXT"),
            safe_add_col(c, "tasks", "assigned_to", "INTEGER"),
            safe_add_col(c, "tasks", "due_date", "TEXT"),
            safe_add_col(c, "cleaning_zones", "assigned_to", "INTEGER"),
            safe_add_col(c, "cleaning_tasks", "assigned_to", "INTEGER"),
            safe_add_col(c, "events", "end_date", "TEXT"),
            safe_add_col(c, "settings", "digest_time", "TEXT DEFAULT '09:00'"),
        ],
        # v2: zone reminders
        lambda c: [
            safe_add_col(c, "cleaning_tasks", "reset_days", "INTEGER DEFAULT 7"),
            safe_add_col(c, "cleaning_tasks", "last_done", "TEXT"),
            safe_add_col(c, "cleaning_tasks", "icon", "TEXT DEFAULT '🧹'"),
        ],
        # v3: shopping quantities + folders + price
        lambda c: [
            safe_add_col(c, "shopping", "quantity", "TEXT"),
            safe_add_col(c, "shopping", "folder_id", "INTEGER"),
            safe_add_col(c, "shopping", "price", "REAL"),
            safe_add_col(c, "shopping", "currency", "TEXT DEFAULT 'RSD'"),
        ],
        # v4: money — seed default categories for all families
        lambda c: _seed_categories(c),
        # v5: trello sync — card id on tasks
        lambda c: [
            safe_add_col(c, "tasks", "trello_card_id", "TEXT"),
        ],
        # v6: digest dedup
        lambda c: [
            safe_add_col(c, "settings", "last_digest", "TEXT"),
        ],
        # v7: digest config — section order + enabled/disabled
        lambda c: [
            safe_add_col(c, "settings", "digest_sections", "TEXT"),
        ],
        # v8: transaction items table (structured receipt breakdown)
        lambda c: [
            c.executescript("""CREATE TABLE IF NOT EXISTS transaction_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                transaction_id INTEGER NOT NULL,
                family_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                amount REAL NOT NULL DEFAULT 0,
                currency TEXT DEFAULT 'RSD',
                created_at TEXT DEFAULT (datetime('now'))
            )"""),
            safe_add_col(c, "transaction_items", "currency", "TEXT DEFAULT 'RSD'"),
        ],
        # v9: ensure currency column exists (fix for v8 race)
        lambda c: safe_add_col(c, "transaction_items", "currency", "TEXT DEFAULT 'RSD'"),
        # v10: quantity field for receipt items
        lambda c: safe_add_col(c, "transaction_items", "quantity", "INTEGER DEFAULT 1"),
        # v11: indexes for hot query paths (purely additive, no data change)
        lambda c: c.executescript("""
            CREATE INDEX IF NOT EXISTS idx_tasks_family_done ON tasks(family_id, done);
            CREATE INDEX IF NOT EXISTS idx_tasks_trello ON tasks(trello_card_id);
            CREATE INDEX IF NOT EXISTS idx_task_reminders_task ON task_reminders(task_id);
            CREATE INDEX IF NOT EXISTS idx_task_reminders_pending ON task_reminders(family_id, sent, remind_at);
            CREATE INDEX IF NOT EXISTS idx_recurring_family ON recurring_tasks(family_id, active);
            CREATE INDEX IF NOT EXISTS idx_shopping_family ON shopping(family_id, bought);
            CREATE INDEX IF NOT EXISTS idx_events_family_date ON events(family_id, event_date);
            CREATE INDEX IF NOT EXISTS idx_birthdays_family ON birthdays(family_id);
            CREATE INDEX IF NOT EXISTS idx_birthday_reminders_bday ON birthday_reminders(birthday_id);
            CREATE INDEX IF NOT EXISTS idx_birthday_reminders_family ON birthday_reminders(family_id);
            CREATE INDEX IF NOT EXISTS idx_subs_family ON subscriptions(family_id);
            CREATE INDEX IF NOT EXISTS idx_sub_reminders_sub ON subscription_reminders(sub_id);
            CREATE INDEX IF NOT EXISTS idx_sub_reminders_family ON subscription_reminders(family_id);
            CREATE INDEX IF NOT EXISTS idx_subtasks_parent ON subtasks(parent_type, parent_id);
            CREATE INDEX IF NOT EXISTS idx_cleaning_tasks_zone ON cleaning_tasks(zone_id);
            CREATE INDEX IF NOT EXISTS idx_cleaning_tasks_family ON cleaning_tasks(family_id);
            CREATE INDEX IF NOT EXISTS idx_zones_family ON cleaning_zones(family_id);
            CREATE INDEX IF NOT EXISTS idx_zone_reminders_zone ON zone_reminders(zone_id);
            CREATE INDEX IF NOT EXISTS idx_zone_reminders_pending ON zone_reminders(family_id, sent, remind_at);
            CREATE INDEX IF NOT EXISTS idx_transactions_family_date ON transactions(family_id, date);
            CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_id);
            CREATE INDEX IF NOT EXISTS idx_tx_items_tx ON transaction_items(transaction_id);
            CREATE INDEX IF NOT EXISTS idx_tx_items_family ON transaction_items(family_id);
            CREATE INDEX IF NOT EXISTS idx_categories_family ON categories(family_id, type);
            CREATE INDEX IF NOT EXISTS idx_members_family ON family_members(family_id);
        """),
        # v12: trainings — exercise catalog + workout sessions + sets + indexes + seed
        _migrate_v12_trainings,
        # v13: workout templates + workout duration tracking (started_at/finished_at)
        _migrate_v13_templates,
        # v14: per-member theme preference (was family-level)
        lambda c: safe_add_col(c, "family_members", "theme", "TEXT"),
        # v15: per-member custom theme colors (JSON: {bg, sf, pr, ac, ok})
        lambda c: safe_add_col(c, "family_members", "custom_theme", "TEXT"),
        # v16: family weather location (overrides env-default Belgrade)
        lambda c: [
            safe_add_col(c, "settings", "weather_lat", "REAL"),
            safe_add_col(c, "settings", "weather_lon", "REAL"),
            safe_add_col(c, "settings", "weather_city", "TEXT"),
        ],
        # v17: vocabulary learning — per-member word progress
        lambda c: [
            c.executescript("""
                CREATE TABLE IF NOT EXISTS word_progress (
                    user_id INTEGER NOT NULL,
                    word_idx INTEGER NOT NULL,
                    mode TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'new',
                    attempts INTEGER DEFAULT 0,
                    correct_count INTEGER DEFAULT 0,
                    last_seen TEXT,
                    PRIMARY KEY (user_id, word_idx, mode)
                );
                CREATE INDEX IF NOT EXISTS idx_word_progress_user ON word_progress(user_id, mode);
                CREATE TABLE IF NOT EXISTS word_image_cache (
                    word_key TEXT PRIMARY KEY,
                    image_url TEXT NOT NULL,
                    fetched_at TEXT DEFAULT (datetime('now'))
                );
            """),
            safe_add_col(c, "family_members", "learn_mode", "TEXT DEFAULT 'en'"),
        ],
        # v18: custom words — user-added vocab via bot. Idx starts at 10000 to avoid
        # clashes with the static catalog (0..N-1) even if it grows later. Status flow:
        # 'pending' (awaiting user confirmation) → 'active' (visible in Words) → 'deleted' (hidden).
        lambda c: c.executescript("""
            CREATE TABLE IF NOT EXISTS custom_words (
                idx INTEGER PRIMARY KEY,
                status TEXT NOT NULL DEFAULT 'pending',
                en_word TEXT NOT NULL,
                ru_word TEXT NOT NULL,
                en_ipa TEXT, ru_ipa TEXT,
                en_def TEXT, ru_def TEXT,
                en_example TEXT, ru_example TEXT,
                emoji TEXT DEFAULT '📖',
                added_by INTEGER,
                added_by_name TEXT,
                family_id INTEGER,
                added_at TEXT DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_custom_words_status ON custom_words(status);
            CREATE INDEX IF NOT EXISTS idx_custom_words_en ON custom_words(en_word) WHERE status='active';
        """),
        # v19: word_overrides — edits to static catalog entries. Sparse table; presence of row
        # means "use these values instead of words_of_day.py for this idx". Custom words
        # (idx >= 10000) bypass this and are edited in custom_words directly.
        lambda c: c.executescript("""
            CREATE TABLE IF NOT EXISTS word_overrides (
                idx INTEGER PRIMARY KEY,
                en_word TEXT, ru_word TEXT,
                en_ipa TEXT, ru_ipa TEXT,
                en_def TEXT, ru_def TEXT,
                en_example TEXT, ru_example TEXT,
                emoji TEXT,
                updated_at TEXT DEFAULT (datetime('now')),
                updated_by INTEGER
            );
        """),
        # v20: drop the orphan word_image_cache table (left behind from the dropped
        # Unsplash integration in v8.23.1). Words use hand-uploaded files now —
        # no cache table needed.
        lambda c: c.executescript("DROP TABLE IF EXISTS word_image_cache;"),
        # v21: Plants feature — family-shared plant collection with AI-identified species,
        # watering schedule + history, and reminders. Photo per plant stored at
        # /app/frontend/plants/<id>.jpg (volume-mounted, same pattern as words/weather).
        lambda c: c.executescript("""
            CREATE TABLE IF NOT EXISTS plants (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                family_id INTEGER NOT NULL,
                custom_name TEXT,
                species TEXT,
                latin_name TEXT,
                water_interval_days INTEGER DEFAULT 7,
                light TEXT,
                care_tips TEXT,            -- JSON array of strings
                notes TEXT,
                last_watered TEXT,
                added_by INTEGER,
                added_at TEXT DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_plants_family ON plants(family_id);

            CREATE TABLE IF NOT EXISTS plant_waterings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                plant_id INTEGER NOT NULL,
                watered_at TEXT DEFAULT (datetime('now')),
                watered_by INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_waterings_plant ON plant_waterings(plant_id, watered_at DESC);

            CREATE TABLE IF NOT EXISTS plant_reminders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                plant_id INTEGER NOT NULL,
                family_id INTEGER NOT NULL,
                remind_at TEXT NOT NULL,
                sent INTEGER DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_plant_reminders_pending ON plant_reminders(sent, remind_at);
        """),
        # v22: species-level cache so AI's tips/interval/light stay consistent across
        # multiple plants of the same species (and we skip the AI work the 2nd+ time).
        # Keyed by lowercased latin_name — that's the universal botanical identifier.
        lambda c: c.executescript("""
            CREATE TABLE IF NOT EXISTS plant_species_cache (
                latin_name TEXT PRIMARY KEY,    -- LOWER(canonical Latin binomial)
                species TEXT,                    -- English common name (last seen)
                water_interval_days INTEGER,
                light TEXT,
                care_tips TEXT,                  -- JSON array
                cached_at TEXT DEFAULT (datetime('now'))
            );
        """),
        # v23: per-plant voice overrides — JSON {ok, soon, thirsty} with any subset of
        # custom speech-bubble phrases that take precedence over the static PLANT_VOICE bank.
        lambda c: safe_add_col(c, "plants", "voice_overrides", "TEXT"),
        # v24: plant growth timeline — multiple photos per plant with caption + taken_at.
        # Files stored at /app/frontend/plants/timeline/<photo_id>.jpg; URL /static/plants/timeline/<id>.jpg
        lambda c: c.executescript("""
            CREATE TABLE IF NOT EXISTS plant_photos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                plant_id INTEGER NOT NULL,
                caption TEXT,
                taken_at TEXT DEFAULT (datetime('now')),
                added_by INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_plant_photos_plant ON plant_photos(plant_id, taken_at DESC);
        """),
        # v25: per-member UI language preference. Defaults to 'en'. Frontend reads from
        # /api/family/status into a global `_lang` var; t(key) helper picks ru vs en strings.
        lambda c: safe_add_col(c, "family_members", "lang", "TEXT DEFAULT 'en'"),
        # v26: AI health check on growth-timeline photos. JSON {status, summary, issues[], advice[]}
        # written by `_assess_plant_health` after each Update tap. NULL for photos uploaded before v26.
        lambda c: safe_add_col(c, "plant_photos", "ai_analysis", "TEXT"),
        # v27: per-member bottom-nav preference. JSON array of tab ids (e.g. ["home","tasks","plants","money","profile"]).
        # NULL = default 5 (home/tasks/words/money/profile). Frontend reads from /api/family/status.
        lambda c: safe_add_col(c, "family_members", "nav_tabs", "TEXT"),
        # v28: Cooking — dishes + dish_ingredients.
        # Dish image stored at /app/frontend/dishes/<id>.jpg (volume-bound on VPS).
        # Ingredient prices captured at save time. Total cost computed as sum(qty*price)
        # but we just sum the per-ingredient "line" price stored in dish_ingredients.price.
        # Auto-price-lookup happens client-side via /api/dishes/price-lookup which matches
        # by lowered/trimmed ingredient name against the shopping table.
        lambda c: c.executescript("""
            CREATE TABLE IF NOT EXISTS dishes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                family_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                description TEXT,
                servings INTEGER NOT NULL DEFAULT 2,
                cook_time_min INTEGER,
                favorite INTEGER NOT NULL DEFAULT 0,
                added_by INTEGER,
                added_at TEXT DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_dishes_family ON dishes(family_id);

            CREATE TABLE IF NOT EXISTS dish_ingredients (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                dish_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                quantity REAL,
                unit TEXT,
                price REAL,
                sort_order INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_dish_ingredients_dish ON dish_ingredients(dish_id, sort_order);
        """),
        # v29: one-time backfill — insert the original cover photo as the first
        # plant_photos entry for any plant whose timeline lacks a near-creation
        # row. Fixes plants that were updated before v8.49.3 (whose original was
        # never timelined) so the strip can show them as the first chronological
        # entry with the creation date. See _backfill_original_cover_timeline.
        lambda c: _backfill_original_cover_timeline(c),
        # v30: Life — habit/balance network (v8.51.0). Two area sets live as code
        # constants (PERSONAL_AREAS + RELATIONSHIP_AREAS in app.py), so no `areas`
        # table. Each habit feeds exactly one area and belongs to an `owner`
        # ('<user_id>' for personal, 'family' for relationship habits).
        #   - habits: the nodes you plant inside an area
        #   - habit_logs: one row per (habit, day) completion → drives streak/consistency
        #   - node_overrides: sparse per-(owner,area) name/emoji customization
        #     (long-press edit). Empty row → fall back to the code default.
        lambda c: c.executescript("""
            CREATE TABLE IF NOT EXISTS habits (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                family_id INTEGER NOT NULL,
                owner TEXT NOT NULL,              -- '<user_id>' | 'family'
                area_id TEXT NOT NULL,            -- 'focus' | ... | 'rel_time' | ...
                name TEXT NOT NULL,
                emoji TEXT,
                type TEXT NOT NULL DEFAULT 'build',  -- build | maintain | reduce
                intent TEXT,
                frequency TEXT,                  -- JSON: 'daily' or [0..6] weekdays
                created_at TEXT DEFAULT (datetime('now')),
                archived INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_habits_scope ON habits(family_id, owner, area_id, archived);

            CREATE TABLE IF NOT EXISTS habit_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                habit_id INTEGER NOT NULL,
                date TEXT NOT NULL,              -- YYYY-MM-DD (local TZ)
                done INTEGER NOT NULL DEFAULT 1
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_habit_logs_unique ON habit_logs(habit_id, date);

            CREATE TABLE IF NOT EXISTS node_overrides (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                family_id INTEGER NOT NULL,
                owner TEXT NOT NULL,             -- whose customization: '<user_id>' | 'family'
                area_id TEXT NOT NULL,
                name TEXT,
                emoji TEXT
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_node_overrides_unique ON node_overrides(family_id, owner, area_id);
        """),
        # v31: Life — per-member editable PERSONAL spheres (add/delete). Relationship
        # (family) areas stay code constants. Rows here define which personal areas an
        # owner has + custom-area metadata. Default seeds have NULL name/emoji/color
        # (resolved from PERSONAL_AREAS constants, keeping bilingual names); custom
        # areas store their own. Renames still ride on node_overrides. Seeded lazily
        # on first access per (family, owner). See _life_effective_areas in app.py.
        lambda c: c.executescript("""
            CREATE TABLE IF NOT EXISTS life_areas (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                family_id INTEGER NOT NULL,
                owner TEXT NOT NULL,
                area_key TEXT NOT NULL,
                name TEXT, emoji TEXT, color TEXT,
                is_custom INTEGER NOT NULL DEFAULT 0,
                sort_order INTEGER NOT NULL DEFAULT 0
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_life_areas_uq ON life_areas(family_id, owner, area_key);
        """),
        # v32: Plants — growth stage (seed | sprout | young | mature). Set by the
        # AI on add (seeds/pits/cuttings now identify instead of being rejected),
        # editable as the plant grows. NULL = unknown/mature for pre-v32 plants.
        lambda c: safe_add_col(c, "plants", "stage", "TEXT"),
        # v33: Life — Challenges (Phase 3). Time-bound goals on a habit / sphere /
        # any. kind='count' (N completions in the window) or 'streak' (N days in a
        # row). Bound to habit_id OR area_id OR neither (any habit). Progress +
        # status (active/done/failed) computed from habit_logs; nothing cached.
        lambda c: c.executescript("""
            CREATE TABLE IF NOT EXISTS life_challenges (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                family_id INTEGER NOT NULL,
                owner TEXT NOT NULL,
                title TEXT NOT NULL,
                emoji TEXT,
                kind TEXT NOT NULL DEFAULT 'count',
                target INTEGER NOT NULL,
                habit_id INTEGER,
                area_id TEXT,
                period_days INTEGER NOT NULL DEFAULT 7,
                start_date TEXT NOT NULL,
                created_at TEXT DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_life_challenges_scope ON life_challenges(family_id, owner);
        """),
        # v34: Challenges with participants (per-person tracking). JSON array of
        # user_ids. NULL = solo (owner-scoped). When set, the challenge is stored
        # under owner='family' (both see it) and progress is computed per
        # participant from THEIR own habits — a little leaderboard.
        lambda c: safe_add_col(c, "life_challenges", "participants", "TEXT"),
    ]

    for i, mig in enumerate(migrations):
        if ver <= i:
            try:
                mig(con)
                con.execute("UPDATE schema_version SET version=?", (i + 1,))
                con.commit()
                log.info(f"✅ Migration v{i+1} applied")
            except Exception as e:
                log.error(f"Migration v{i+1} failed: {e}")

    con.close()
    log.info(f"DB ready, schema version: {max(ver, len(migrations))}")
