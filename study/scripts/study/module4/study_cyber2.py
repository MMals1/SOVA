from eth_keyfile.keyfile import create_keyfile_json, decode_keyfile_json
import json
import os

# Создаём keystore файл
private_key = bytes.fromhex("cdb7166534ea4d44a2c7f0cf9bb28cb7ca647702b19281e8124f605cf6da6432")
password = b"mypassword123"

keystore = create_keyfile_json(private_key, password)  # type: ignore[arg-type]
print("Keystore:")
print(json.dumps(keystore, indent=2))

# Восстанавливаем приватный ключ из keystore
recovered_key = decode_keyfile_json(keystore, password)  # type: ignore[arg-type]
print("\nВосстановленный ключ:", recovered_key.hex())
print("Совпадает:", recovered_key == private_key)