import os
from dotenv import load_dotenv

load_dotenv()

bytes_for_entropy = 16

# BIP44 путь деривации для Ethereum: m/44'/60'/0'/0/0
DERIVATION_PATH = [
    0x80000000 + 44,   # purpose: 44'
    0x80000000 + 60,   # coin_type: 60' (Ethereum)
    0x80000000 + 0,    # account: 0'
    0,                 # change: 0 (external)
    0,                 # address_index: 0
]

ALCHEMY_URL = os.getenv("ALCHEMY_URL")
