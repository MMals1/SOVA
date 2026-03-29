import time
import hashlib
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt
from cryptography.hazmat.backends import default_backend

password = b"mypassword"
salt = b"randomsalt"

# PBKDF2
start = time.time()
key1 = hashlib.pbkdf2_hmac('sha256', password, salt, 2048, 32)
print(f"PBKDF2:  {time.time() - start:.3f} сек")

# Scrypt
start = time.time()
kdf = Scrypt(salt=salt, length=32, n=262144, r=8, p=1, backend=default_backend())
key2 = kdf.derive(password)
print(f"Scrypt:  {time.time() - start:.3f} сек")