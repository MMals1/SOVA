import json
from eth_keyfile.keyfile import create_keyfile_json as create_keystore, decode_keyfile_json as decode_keystore

def save_keystore(keystore: dict, path: str):
    with open(path, 'w') as f:
        json.dump(keystore, f, indent=2)
    print(f"Keystore сохранён: {path}")

def load_keystore(path: str) -> dict:
    with open(path, 'r') as f:
        return json.load(f)

# Тест сохранения и загрузки
private_key = bytes.fromhex("cdb7166534ea4d44a2c7f0cf9bb28cb7ca647702b19281e8124f605cf6da6432")
password = b"mypassword123"

keystore = create_keystore(private_key, password)  # type: ignore[arg-type]
save_keystore(keystore, "my_wallet.json")

loaded = load_keystore("my_wallet.json")
recovered = decode_keystore(loaded, password)  # type: ignore[arg-type]
print("Загружен с диска и расшифрован:", recovered == private_key)