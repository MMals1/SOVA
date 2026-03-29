import hashlib
import hmac
from mnemonic import Mnemonic
from coincurve import PublicKey
from config import DERIVATION_PATH

SECP256K1_N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141


def generate_masterKey_and_chainCode(phrase: str) -> tuple[bytes, bytes]:
    """
    Генерирует мастер-ключ и цепной код из мнемонической фразы (BIP32).

    Returns:
        Кортеж (master_privkey, master_chain) в виде байтов.
    """
    seed = Mnemonic.to_seed(phrase, passphrase="")
    raw = hmac.new(b"Bitcoin seed", seed, hashlib.sha512).digest()
    return raw[:32], raw[32:]


def derive_child(parent_privkey: bytes, chain_code: bytes, index: int) -> tuple[bytes, bytes]:
    """
    Деривирует дочерний ключ по индексу (BIP32).
    Hardened деривация активируется автоматически при index >= 0x80000000.
    """
    if index >= 0x80000000:
        data = b'\x00' + parent_privkey + index.to_bytes(4, 'big')
    else:
        data = PublicKey.from_valid_secret(parent_privkey).format(compressed=True) + index.to_bytes(4, 'big')

    raw = hmac.new(chain_code, data, hashlib.sha512).digest()

    child_privkey = (int.from_bytes(raw[:32], 'big') + int.from_bytes(parent_privkey, 'big')) % SECP256K1_N
    return child_privkey.to_bytes(32, 'big'), raw[32:]


def calculate_private_key_from_path(master_privkey: bytes, master_chain: bytes, path: list[int]) -> bytes:
    """
    Деривирует дочерний приватный ключ по пути деривации (BIP32).
    """
    key, chain = master_privkey, master_chain
    for index in path:
        key, chain = derive_child(key, chain, index)
    return key
