import os
import json
import uuid
from eth_hash.auto import keccak
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.backends import default_backend


def create_keystore(private_key: bytes, password: str, address: str = "") -> dict:
    """
    Шифрует приватный ключ в формат Ethereum keystore v3.
    Использует scrypt (KDF) + AES-128-CTR (шифрование).
    """
    password_bytes = password.encode("utf-8")

    salt = os.urandom(32)
    iv   = os.urandom(16)

    kdf = Scrypt(salt=salt, length=32, n=262144, r=8, p=1, backend=default_backend())
    derived_key = kdf.derive(password_bytes)

    cipher = Cipher(
        algorithms.AES(derived_key[:16]),
        modes.CTR(iv),
        backend=default_backend(),
    )
    encryptor  = cipher.encryptor()
    ciphertext = encryptor.update(private_key) + encryptor.finalize()

    mac = keccak(derived_key[16:32] + ciphertext)

    return {
        "version": 3,
        "id": str(uuid.uuid4()),
        "address": address,
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
                "salt": salt.hex(),
            },
            "mac": mac.hex(),
        },
    }


def decode_keystore(keystore: dict, password: str) -> bytes:
    """
    Расшифровывает приватный ключ из keystore v3.
    Выбрасывает ValueError при неверном пароле.
    """
    password_bytes = password.encode("utf-8")
    params = keystore["crypto"]["kdfparams"]

    kdf = Scrypt(
        salt=bytes.fromhex(params["salt"]),
        length=params["dklen"],
        n=params["n"],
        r=params["r"],
        p=params["p"],
        backend=default_backend(),
    )
    derived_key = kdf.derive(password_bytes)

    ciphertext = bytes.fromhex(keystore["crypto"]["ciphertext"])
    mac = keccak(derived_key[16:32] + ciphertext)
    if mac.hex() != keystore["crypto"]["mac"]:
        raise ValueError("Неверный пароль")

    iv = bytes.fromhex(keystore["crypto"]["cipherparams"]["iv"])
    cipher = Cipher(
        algorithms.AES(derived_key[:16]),
        modes.CTR(iv),
        backend=default_backend(),
    )
    decryptor = cipher.decryptor()
    return decryptor.update(ciphertext) + decryptor.finalize()


def save_keystore(keystore: dict, path: str) -> None:
    """Сохраняет keystore в JSON-файл."""
    os.makedirs(os.path.dirname(path), exist_ok=True) if os.path.dirname(path) else None
    with open(path, "w") as f:
        json.dump(keystore, f, indent=2)


def load_keystore(path: str) -> dict:
    """Загружает keystore из JSON-файла."""
    with open(path, "r") as f:
        return json.load(f)
