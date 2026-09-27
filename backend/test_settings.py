from app.api.v1.settings import show_settings
from app.services.core import ServiceContainer
from app.models import User, Account
from app.db import SessionLocal

db = SessionLocal()
services = ServiceContainer(db)

user = db.query(User).filter_by(email="abassahmed1738@gmail.com").first()
user._active_account_id = "ec165c19-d2d5-4dfd-b9f3-4696a6b39ec5"
print(show_settings(None, services, None, user))
