"""Telegram bot — opens the Mini App."""
import os, logging
from telegram import Update, WebAppInfo, MenuButtonWebApp, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import Application, CommandHandler, ContextTypes

BOT_TOKEN = os.environ.get("BOT_TOKEN", "YOUR_TOKEN_HERE")
WEBAPP_URL = os.environ.get("WEBAPP_URL", "https://your-domain.com")
logging.basicConfig(format="%(asctime)s [%(levelname)s] %(message)s", level=logging.INFO)

async def post_init(app: Application):
    await app.bot.set_chat_menu_button(menu_button=MenuButtonWebApp(text="🏠 Family HQ", web_app=WebAppInfo(url=WEBAPP_URL)))
    await app.bot.set_my_commands([("start", "Open Family HQ"), ("help", "How to use")])

async def cmd_start(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    kb = InlineKeyboardMarkup([[InlineKeyboardButton("🏠 Open Family HQ", web_app=WebAppInfo(url=WEBAPP_URL))]])
    await update.message.reply_text(
        "👨‍👩‍👧‍👦 *Family HQ v5*\n\n"
        "📋 Tasks & Recurring\n🛒 Shopping with folders\n🧹 Cleaning zones\n"
        "📅 Events, Birthdays & Subscriptions\n🎨 6 themes\n\nTap below to open!",
        reply_markup=kb, parse_mode="Markdown")

async def cmd_help(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("Tap the 🏠 button below the chat to open the app.", parse_mode="Markdown")

def main():
    app = Application.builder().token(BOT_TOKEN).post_init(post_init).build()
    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(CommandHandler("help", cmd_help))
    app.run_polling(allowed_updates=Update.ALL_TYPES)

if __name__ == "__main__": main()
