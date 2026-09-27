from app.database import SessionLocal
from app.models import Account, User, UserMembership
from app.support.merchant_permissions import is_membership_owner

db = SessionLocal()
memberships = db.query(UserMembership).all()
for m in memberships:
    user = db.query(User).filter(User.id == m.user_id).first()
    setattr(user, "memberships", [m])
    owner = is_membership_owner(user, str(m.account_id))
    print(f"User: {user.email}, Role: {m.role}, Owner: {owner}")
