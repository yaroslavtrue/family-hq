"""
Database migration system. Runs on app startup.
Creates tables and adds columns without losing data.
"""
import sqlite3, logging

log = logging.getLogger("uvicorn.error")

def safe_add_col(con, table, col, ctype):
    try: con.execute(f"ALTER TABLE {table} ADD COLUMN {col} {ctype}"); con.commit()
    except: pass

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
