"""
Local Authentication Service

Provides local authentication for self-hosted mode using either
LDAP or a local SQLite database. This enables multi-user authentication
without requiring external services like Supabase.

Strategy:
1. Support multiple auth backends (LDAP, SQLite)
2. User management (create, update, delete)
3. Session management with JWT tokens
4. Password hashing with bcrypt
"""

from datetime import datetime, timedelta
from typing import Optional
import hashlib
import secrets
import sqlite3
import json
from pathlib import Path

from ..config import get_settings

# ─────────────────────────────────────────────────────────────────────────────
# Types
# ─────────────────────────────────────────────────────────────────────────────

class LocalUser:
    """Local user model."""
    
    def __init__(
        self,
        id: str,
        username: str,
        email: str,
        password_hash: str,
        display_name: Optional[str] = None,
        is_active: bool = True,
        is_admin: bool = False,
        created_at: Optional[datetime] = None,
        updated_at: Optional[datetime] = None,
    ):
        self.id = id
        self.username = username
        self.email = email
        self.password_hash = password_hash
        self.display_name = display_name or username
        self.is_active = is_active
        self.is_admin = is_admin
        self.created_at = created_at or datetime.utcnow()
        self.updated_at = updated_at or datetime.utcnow()

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "username": self.username,
            "email": self.email,
            "display_name": self.display_name,
            "is_active": self.is_active,
            "is_admin": self.is_admin,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }


class LocalSession:
    """Local session model."""
    
    def __init__(
        self,
        id: str,
        user_id: str,
        token: str,
        expires_at: datetime,
        created_at: Optional[datetime] = None,
    ):
        self.id = id
        self.user_id = user_id
        self.token = token
        self.expires_at = expires_at
        self.created_at = created_at or datetime.utcnow()


# ─────────────────────────────────────────────────────────────────────────────
# Password Hashing
# ─────────────────────────────────────────────────────────────────────────────

def hash_password(password: str) -> str:
    """Hash password with SHA-256 (for demo; use bcrypt in production)."""
    salt = secrets.token_hex(16)
    hash_value = hashlib.sha256(f"{salt}{password}".encode()).hexdigest()
    return f"{salt}${hash_value}"


def verify_password(password: str, password_hash: str) -> bool:
    """Verify password against hash."""
    try:
        salt, hash_value = password_hash.split("$")
        computed = hashlib.sha256(f"{salt}{password}".encode()).hexdigest()
        return computed == hash_value
    except Exception:
        return False


# ─────────────────────────────────────────────────────────────────────────────
# SQLite Auth Backend
# ─────────────────────────────────────────────────────────────────────────────

class SQLiteAuthBackend:
    """SQLite-based local authentication backend."""
    
    def __init__(self, db_path: Optional[str] = None):
        self.db_path = db_path or str(
            Path.home() / ".config" / "pakalon" / "local_auth.db"
        )
        self._init_db()
    
    def _init_db(self) -> None:
        """Initialize the database schema."""
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY,
                    username TEXT UNIQUE NOT NULL,
                    email TEXT UNIQUE NOT NULL,
                    password_hash TEXT NOT NULL,
                    display_name TEXT,
                    is_active BOOLEAN DEFAULT 1,
                    is_admin BOOLEAN DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            
            conn.execute("""
                CREATE TABLE IF NOT EXISTS sessions (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    token TEXT UNIQUE NOT NULL,
                    expires_at TIMESTAMP NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users(id)
                )
            """)
            
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_sessions_token 
                ON sessions(token)
            """)
            
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_sessions_user_id 
                ON sessions(user_id)
            """)
    
    def create_user(
        self,
        username: str,
        email: str,
        password: str,
        display_name: Optional[str] = None,
        is_admin: bool = False,
    ) -> LocalUser:
        """Create a new user."""
        user_id = secrets.token_hex(16)
        password_hash = hash_password(password)
        
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """
                INSERT INTO users (id, username, email, password_hash, display_name, is_admin)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (user_id, username, email, password_hash, display_name, is_admin),
            )
        
        return LocalUser(
            id=user_id,
            username=username,
            email=email,
            password_hash=password_hash,
            display_name=display_name,
            is_admin=is_admin,
        )
    
    def get_user_by_id(self, user_id: str) -> Optional[LocalUser]:
        """Get user by ID."""
        with sqlite3.connect(self.db_path) as conn:
            row = conn.execute(
                "SELECT * FROM users WHERE id = ?", (user_id,)
            ).fetchone()
        
        if not row:
            return None
        
        return LocalUser(
            id=row[0],
            username=row[1],
            email=row[2],
            password_hash=row[3],
            display_name=row[4],
            is_active=bool(row[5]),
            is_admin=bool(row[6]),
            created_at=datetime.fromisoformat(row[7]),
            updated_at=datetime.fromisoformat(row[8]),
        )
    
    def get_user_by_username(self, username: str) -> Optional[LocalUser]:
        """Get user by username."""
        with sqlite3.connect(self.db_path) as conn:
            row = conn.execute(
                "SELECT * FROM users WHERE username = ?", (username,)
            ).fetchone()
        
        if not row:
            return None
        
        return LocalUser(
            id=row[0],
            username=row[1],
            email=row[2],
            password_hash=row[3],
            display_name=row[4],
            is_active=bool(row[5]),
            is_admin=bool(row[6]),
            created_at=datetime.fromisoformat(row[7]),
            updated_at=datetime.fromisoformat(row[8]),
        )
    
    def get_user_by_email(self, email: str) -> Optional[LocalUser]:
        """Get user by email."""
        with sqlite3.connect(self.db_path) as conn:
            row = conn.execute(
                "SELECT * FROM users WHERE email = ?", (email,)
            ).fetchone()
        
        if not row:
            return None
        
        return LocalUser(
            id=row[0],
            username=row[1],
            email=row[2],
            password_hash=row[3],
            display_name=row[4],
            is_active=bool(row[5]),
            is_admin=bool(row[6]),
            created_at=datetime.fromisoformat(row[7]),
            updated_at=datetime.fromisoformat(row[8]),
        )
    
    def authenticate(self, username: str, password: str) -> Optional[LocalUser]:
        """Authenticate user with username and password."""
        user = self.get_user_by_username(username)
        if not user:
            return None
        
        if not verify_password(password, user.password_hash):
            return None
        
        if not user.is_active:
            return None
        
        return user
    
    def update_user(
        self,
        user_id: str,
        display_name: Optional[str] = None,
        email: Optional[str] = None,
        is_active: Optional[bool] = None,
        is_admin: Optional[bool] = None,
    ) -> Optional[LocalUser]:
        """Update user fields."""
        updates = []
        params = []
        
        if display_name is not None:
            updates.append("display_name = ?")
            params.append(display_name)
        
        if email is not None:
            updates.append("email = ?")
            params.append(email)
        
        if is_active is not None:
            updates.append("is_active = ?")
            params.append(is_active)
        
        if is_admin is not None:
            updates.append("is_admin = ?")
            params.append(is_admin)
        
        if not updates:
            return self.get_user_by_id(user_id)
        
        updates.append("updated_at = CURRENT_TIMESTAMP")
        params.append(user_id)
        
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                f"UPDATE users SET {', '.join(updates)} WHERE id = ?",
                params,
            )
        
        return self.get_user_by_id(user_id)
    
    def delete_user(self, user_id: str) -> bool:
        """Delete user."""
        with sqlite3.connect(self.db_path) as conn:
            # Delete sessions first
            conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
            # Delete user
            cursor = conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
            return cursor.rowcount > 0
    
    def create_session(self, user_id: str, expires_in_days: int = 30) -> LocalSession:
        """Create a new session."""
        session_id = secrets.token_hex(16)
        token = secrets.token_urlsafe(32)
        expires_at = datetime.utcnow() + timedelta(days=expires_in_days)
        
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """
                INSERT INTO sessions (id, user_id, token, expires_at)
                VALUES (?, ?, ?, ?)
                """,
                (session_id, user_id, token, expires_at.isoformat()),
            )
        
        return LocalSession(
            id=session_id,
            user_id=user_id,
            token=token,
            expires_at=expires_at,
        )
    
    def get_session_by_token(self, token: str) -> Optional[LocalSession]:
        """Get session by token."""
        with sqlite3.connect(self.db_path) as conn:
            row = conn.execute(
                "SELECT * FROM sessions WHERE token = ?", (token,)
            ).fetchone()
        
        if not row:
            return None
        
        expires_at = datetime.fromisoformat(row[3])
        if expires_at < datetime.utcnow():
            # Session expired
            self.delete_session(row[0])
            return None
        
        return LocalSession(
            id=row[0],
            user_id=row[1],
            token=row[2],
            expires_at=expires_at,
            created_at=datetime.fromisoformat(row[4]),
        )
    
    def delete_session(self, session_id: str) -> bool:
        """Delete session."""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute(
                "DELETE FROM sessions WHERE id = ?", (session_id,)
            )
            return cursor.rowcount > 0
    
    def delete_user_sessions(self, user_id: str) -> int:
        """Delete all sessions for a user."""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute(
                "DELETE FROM sessions WHERE user_id = ?", (user_id,)
            )
            return cursor.rowcount
    
    def cleanup_expired_sessions(self) -> int:
        """Remove expired sessions."""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute(
                "DELETE FROM sessions WHERE expires_at < ?",
                (datetime.utcnow().isoformat(),),
            )
            return cursor.rowcount


# ─────────────────────────────────────────────────────────────────────────────
# LDAP Auth Backend
# ─────────────────────────────────────────────────────────────────────────────

class LDAPAuthBackend:
    """LDAP-based authentication backend."""
    
    def __init__(
        self,
        server_url: str,
        base_dn: str,
        bind_dn: Optional[str] = None,
        bind_password: Optional[str] = None,
        user_search_filter: str = "(uid={username})",
        use_ssl: bool = True,
    ):
        self.server_url = server_url
        self.base_dn = base_dn
        self.bind_dn = bind_dn
        self.bind_password = bind_password
        self.user_search_filter = user_search_filter
        self.use_ssl = use_ssl
    
    def _get_connection(self):
        """Get LDAP connection (placeholder)."""
        # In production, use python-ldap or ldap3
        raise NotImplementedError(
            "LDAP backend requires python-ldap or ldap3 package"
        )
    
    def authenticate(self, username: str, password: str) -> Optional[LocalUser]:
        """Authenticate user against LDAP."""
        # Placeholder implementation
        # In production, this would:
        # 1. Connect to LDAP server
        # 2. Bind with service account
        # 3. Search for user
        # 4. Try to bind with user credentials
        # 5. Return user if successful
        raise NotImplementedError("LDAP authentication not implemented")


# ─────────────────────────────────────────────────────────────────────────────
# Auth Service
# ─────────────────────────────────────────────────────────────────────────────

class LocalAuthService:
    """Local authentication service."""
    
    def __init__(self, backend: Optional[str] = None):
        self.backend_type = backend or "sqlite"
        
        if self.backend_type == "sqlite":
            self.backend = SQLiteAuthBackend()
        elif self.backend_type == "ldap":
            # LDAP configuration would come from settings
            raise NotImplementedError("LDAP backend not configured")
        else:
            raise ValueError(f"Unknown auth backend: {self.backend_type}")
    
    def register(
        self,
        username: str,
        email: str,
        password: str,
        display_name: Optional[str] = None,
    ) -> dict:
        """Register a new user."""
        # Check if user exists
        existing = self.backend.get_user_by_username(username)
        if existing:
            raise ValueError("Username already exists")
        
        existing = self.backend.get_user_by_email(email)
        if existing:
            raise ValueError("Email already exists")
        
        # Create user
        user = self.backend.create_user(
            username=username,
            email=email,
            password=password,
            display_name=display_name,
        )
        
        # Create session
        session = self.backend.create_session(user.id)
        
        return {
            "user": user.to_dict(),
            "session": {
                "token": session.token,
                "expires_at": session.expires_at.isoformat(),
            },
        }
    
    def login(self, username: str, password: str) -> dict:
        """Login user."""
        user = self.backend.authenticate(username, password)
        if not user:
            raise ValueError("Invalid credentials")
        
        # Create session
        session = self.backend.create_session(user.id)
        
        return {
            "user": user.to_dict(),
            "session": {
                "token": session.token,
                "expires_at": session.expires_at.isoformat(),
            },
        }
    
    def logout(self, token: str) -> bool:
        """Logout user (delete session)."""
        session = self.backend.get_session_by_token(token)
        if not session:
            return False
        
        return self.backend.delete_session(session.id)
    
    def get_current_user(self, token: str) -> Optional[dict]:
        """Get current user from token."""
        session = self.backend.get_session_by_token(token)
        if not session:
            return None
        
        user = self.backend.get_user_by_id(session.user_id)
        if not user:
            return None
        
        return user.to_dict()
    
    def create_admin(self, username: str, email: str, password: str) -> dict:
        """Create an admin user."""
        user = self.backend.create_user(
            username=username,
            email=email,
            password=password,
            is_admin=True,
        )
        
        return user.to_dict()


# ─────────────────────────────────────────────────────────────────────────────
# Singleton
# ─────────────────────────────────────────────────────────────────────────────

_auth_service: Optional[LocalAuthService] = None


def get_auth_service() -> LocalAuthService:
    """Get or create auth service singleton."""
    global _auth_service
    if _auth_service is None:
        # Check if self-hosted mode is enabled
        settings = get_settings()
        backend = getattr(settings, "AUTH_BACKEND", "sqlite")
        _auth_service = LocalAuthService(backend=backend)
    return _auth_service


# ─────────────────────────────────────────────────────────────────────────────
# API Router (FastAPI)
# ─────────────────────────────────────────────────────────────────────────────

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, EmailStr

router = APIRouter(prefix="/auth/local", tags=["local-auth"])


class RegisterRequest(BaseModel):
    username: str
    email: EmailStr
    password: str
    display_name: Optional[str] = None


class LoginRequest(BaseModel):
    username: str
    password: str


class AuthResponse(BaseModel):
    user: dict
    session: dict


@router.post("/register", response_model=AuthResponse)
async def register(request: RegisterRequest):
    """Register a new user."""
    service = get_auth_service()
    try:
        result = service.register(
            username=request.username,
            email=request.email,
            password=request.password,
            display_name=request.display_name,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/login", response_model=AuthResponse)
async def login(request: LoginRequest):
    """Login user."""
    service = get_auth_service()
    try:
        result = service.login(
            username=request.username,
            password=request.password,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e))


@router.post("/logout")
async def logout(token: str):
    """Logout user."""
    service = get_auth_service()
    service.logout(token)
    return {"message": "Logged out"}


@router.get("/me")
async def get_me(token: str):
    """Get current user."""
    service = get_auth_service()
    user = service.get_current_user(token)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid token")
    return user