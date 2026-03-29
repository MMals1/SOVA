import json
import os
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone

from scripts.Accounts.generate_mnemonic import generate_mnemonic
from scripts.Accounts.generate_privateKey import generate_masterKey_and_chainCode, calculate_private_key_from_path
from scripts.Accounts.generate_publicKey import generate_public_key
from scripts.Accounts.generate_address import generate_eth_address
from scripts.Cyber.keystore import create_keystore, decode_keystore
from config import DERIVATION_PATH

WALLETS_DIR = os.path.join(os.path.dirname(__file__), '..', '..', 'wallets')


@dataclass
class Wallet:
    address: str
    public_key: str
    created_at: str
    keystore: dict          # зашифрованный приватный ключ (keystore v3)
    balance: int = 0
    nonce: int = 0
    # Только в памяти — не сохраняется на диск
    private_key: str = field(default="", repr=False)


def create_wallet(password: str) -> Wallet:
    """Генерирует новый кошелёк, шифрует приватный ключ и сохраняет в wallets/<address>.json."""
    phrase = generate_mnemonic()
    master_key, master_chain = generate_masterKey_and_chainCode(phrase)
    private_key_bytes = calculate_private_key_from_path(master_key, master_chain, DERIVATION_PATH)
    public_key = generate_public_key(private_key_bytes)
    address = generate_eth_address(public_key)

    ks = create_keystore(private_key_bytes, password, address=address)

    wallet = Wallet(
        address=address,
        public_key=public_key.hex(),
        created_at=datetime.now(timezone.utc).isoformat(),
        keystore=ks,
        private_key=private_key_bytes.hex(),   # только в памяти
    )

    _save_wallet(wallet)
    return wallet


def load_wallet(address: str, password: str) -> Wallet:
    """Загружает кошелёк из файла и расшифровывает приватный ключ."""
    path = _wallet_path(address)
    if not os.path.exists(path):
        raise FileNotFoundError(f"Кошелёк {address} не найден")
    with open(path) as f:
        data = json.load(f)
    private_key_bytes = decode_keystore(data["keystore"], password)
    wallet = Wallet(**data)
    wallet.private_key = private_key_bytes.hex()
    return wallet


def load_all_wallets() -> list[Wallet]:
    """Загружает все кошельки нового формата (с keystore). Старые файлы пропускает."""
    os.makedirs(WALLETS_DIR, exist_ok=True)
    wallets = []
    for filename in os.listdir(WALLETS_DIR):
        if not filename.endswith('.json'):
            continue
        with open(os.path.join(WALLETS_DIR, filename)) as f:
            data = json.load(f)
        if 'keystore' not in data:
            continue   # старый формат без шифрования — пропускаем
        wallets.append(Wallet(**data))
    return wallets


def update_wallet(wallet: Wallet) -> None:
    """Сохраняет обновлённые данные кошелька (баланс, нонс)."""
    _save_wallet(wallet)


def _save_wallet(wallet: Wallet) -> None:
    os.makedirs(WALLETS_DIR, exist_ok=True)
    data = asdict(wallet)
    data.pop('private_key', None)   # не записываем на диск в открытом виде
    with open(_wallet_path(wallet.address), 'w') as f:
        json.dump(data, f, indent=2)


def _wallet_path(address: str) -> str:
    return os.path.join(WALLETS_DIR, f"{address}.json")
