import os
import json
import uuid
import hashlib
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.backends import default_backend
from eth_hash.auto import keccak

def create_keystore(private_key: bytes, password: str) -> dict:
    password_bytes = password.encode('utf-8')
    
    # Шаг 1: генерируем случайные параметры
    salt = os.urandom(32)
    iv   = os.urandom(16)
    
    # Шаг 2: пароль → ключ шифрования через scrypt
    kdf = Scrypt(salt=salt, length=32, n=262144, r=8, p=1, backend=default_backend())
    derived_key = kdf.derive(password_bytes)
    
    # Шаг 3: шифруем приватный ключ через AES-128-CTR
    cipher = Cipher(
        algorithms.AES(derived_key[:16]),  # первые 16 байт = 128 бит
        modes.CTR(iv),
        backend=default_backend()
    )
    encryptor = cipher.encryptor()
    ciphertext = encryptor.update(private_key) + encryptor.finalize()
    
    # Шаг 4: считаем MAC
    mac = keccak(derived_key[16:32] + ciphertext)
    
    # Шаг 5: собираем keystore файл
    return {
        "version": 3,
        "id": str(uuid.uuid4()),
        "address": "",  # заполним позже
        "crypto": {
            "cipher": "aes-128-ctr",
            "cipherparams": {"iv": iv.hex()},
            "ciphertext": ciphertext.hex(),
            "kdf": "scrypt",
            "kdfparams": {
                "n": 262144,
                "r": 8,
                "p": 1,
                "dklen": 32,
                "salt": salt.hex()
            },
            "mac": mac.hex()
        }
    }

def decode_keystore(keystore: dict, password: str) -> bytes:
    password_bytes = password.encode('utf-8')
    params = keystore["crypto"]["kdfparams"]
    
    # Шаг 1: пароль → ключ шифрования через scrypt
    kdf = Scrypt(
        salt  = bytes.fromhex(params["salt"]),
        length= params["dklen"],
        n     = params["n"],
        r     = params["r"],
        p     = params["p"],
        backend=default_backend()
    )
    derived_key = kdf.derive(password_bytes)
    
    # Шаг 2: проверяем MAC
    ciphertext = bytes.fromhex(keystore["crypto"]["ciphertext"])
    mac = keccak(derived_key[16:32] + ciphertext)
    if mac.hex() != keystore["crypto"]["mac"]:
        raise ValueError("Неверный пароль!")
    
    # Шаг 3: расшифровываем
    iv = bytes.fromhex(keystore["crypto"]["cipherparams"]["iv"])
    cipher = Cipher(
        algorithms.AES(derived_key[:16]),
        modes.CTR(iv),
        backend=default_backend()
    )
    decryptor = cipher.decryptor()
    return decryptor.update(ciphertext) + decryptor.finalize()


# Тест
private_key = bytes.fromhex("cdb7166534ea4d44a2c7f0cf9bb28cb7ca647702b19281e8124f605cf6da6432")
password = "mypassword123"

print("Создаём keystore (подождите ~2 сек)...")
keystore = create_keystore(private_key, password)
print(json.dumps(keystore, indent=2))

print("\nВосстанавливаем ключ...")
recovered = decode_keystore(keystore, password)
print("Совпадает:", recovered == private_key)

print("\nПроверяем неверный пароль...")
try:
    decode_keystore(keystore, "wrongpassword")
except ValueError as e:
    print("Ошибка:", e)