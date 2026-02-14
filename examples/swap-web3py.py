"""
Switch DEX Aggregator — Complete Swap Example (web3.py)

Demonstrates the full swap lifecycle: quote → approve → send.

Usage:
    pip install web3 requests
    export SWITCH_API_KEY=your_key
    export PRIVATE_KEY=your_private_key
    python examples/swap-web3py.py

Prerequisites:
    pip install web3 requests
"""

import os
import sys
import requests
from web3 import Web3

# ── Constants ────────────────────────────────────────────────────────

API_BASE = "https://quote.switch.win"
SWITCH_ROUTER = "0x69033829f50244FD1be7BDC8e74aE0fF97E47126"
NATIVE_PLS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"
RPC_URL = os.environ.get("RPC_URL", "https://rpc.pulsechain.com")

ERC20_ABI = [
    {
        "constant": True,
        "inputs": [
            {"name": "owner", "type": "address"},
            {"name": "spender", "type": "address"},
        ],
        "name": "allowance",
        "outputs": [{"name": "", "type": "uint256"}],
        "type": "function",
    },
    {
        "constant": False,
        "inputs": [
            {"name": "spender", "type": "address"},
            {"name": "amount", "type": "uint256"},
        ],
        "name": "approve",
        "outputs": [{"name": "", "type": "bool"}],
        "type": "function",
    },
]

# ── Configuration ────────────────────────────────────────────────────

API_KEY = os.environ.get("SWITCH_API_KEY")
PRIVATE_KEY = os.environ.get("PRIVATE_KEY")

if not API_KEY:
    print("Error: Set SWITCH_API_KEY env var")
    sys.exit(1)
if not PRIVATE_KEY:
    print("Error: Set PRIVATE_KEY env var")
    sys.exit(1)

# ── Swap parameters ─────────────────────────────────────────────────

FROM_TOKEN = "0xA1077a294dDE1B09bB078844df40758a5D0f9a27"  # WPLS
TO_TOKEN = "0x95B303987A60C71504D99Aa1b13B4DA07b0790ab"  # PLSX
AMOUNT = 1000 * 10**18  # 1000 WPLS in wei
SLIPPAGE_BPS = 100  # 1%
FEE_BPS = 30  # 0.30%
PARTNER_ADDRESS = None  # your partner wallet or None
RECEIVER_ADDRESS = None  # custom recipient address or None to send to sender


def swap(
    w3: Web3,
    account,
    from_token: str,
    to_token: str,
    amount_wei: int,
    slippage_bps: int = 50,
    fee_bps: int = 0,
    fee_on_output: bool = False,
    partner: str | None = None,
    receiver: str | None = None,
):
    """Execute a full swap: quote → approve → send."""
    sender = account.address
    print(f"Sender: {sender}")
    print(f"Swapping {amount_wei} wei of {from_token} → {to_token}")

    # ── 1. Fetch quote ───────────────────────────────────────────
    params = {
        "network": "pulsechain",
        "from": from_token,
        "to": to_token,
        "amount": str(amount_wei),
        "sender": sender,
        "slippage": str(slippage_bps),
    }
    if fee_bps:
        params["fee"] = str(fee_bps)
    if fee_on_output:
        params["feeOnOutput"] = "true"
    if partner:
        params["partnerAddress"] = partner
    if receiver:
        params["receiver"] = receiver

    print(f"\nFetching quote...")
    resp = requests.get(
        f"{API_BASE}/swap/quote",
        params=params,
        headers={"x-api-key": API_KEY},
    )
    resp.raise_for_status()
    quote = resp.json()

    if "error" in quote:
        raise Exception(f"Quote error: {quote['error']}")

    tx_data = quote.get("tx")
    if not tx_data:
        raise Exception("No tx object in response — did you provide sender?")

    print(f"Expected output: {quote['totalAmountOut']}")
    print(f"Min output:      {quote['minAmountOut']}")
    print(f"Eff. slippage:   {quote['effectiveSlippagePercent']}%")
    print(f"Paths:           {len(quote['paths'])}")

    # ── 2. Approve ERC-20 if needed ──────────────────────────────
    if from_token.lower() != NATIVE_PLS.lower():
        token = w3.eth.contract(
            address=Web3.to_checksum_address(from_token), abi=ERC20_ABI
        )
        current_allowance = token.functions.allowance(
            sender, tx_data["to"]
        ).call()

        if current_allowance < amount_wei:
            print("\nApproving SwitchRouter to spend tokens...")
            approve_tx = token.functions.approve(
                tx_data["to"], amount_wei
            ).build_transaction(
                {
                    "from": sender,
                    "nonce": w3.eth.get_transaction_count(sender),
                }
            )
            signed = account.sign_transaction(approve_tx)
            tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
            receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
            print(f"Approved in tx: {receipt['transactionHash'].hex()}")
        else:
            print("\nSufficient allowance already granted")

    # ── 3. Send swap ─────────────────────────────────────────────
    print("\nSending swap transaction...")
    swap_tx = {
        "from": sender,
        "to": Web3.to_checksum_address(tx_data["to"]),
        "data": tx_data["data"],
        "value": int(tx_data["value"]),
        "nonce": w3.eth.get_transaction_count(sender),
    }

    signed = account.sign_transaction(swap_tx)
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
    print(f"Tx hash: {tx_hash.hex()}")

    receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
    print(f"\nSwap confirmed in block {receipt['blockNumber']}")
    return receipt


def main():
    w3 = Web3(Web3.HTTPProvider(RPC_URL))
    if not w3.is_connected():
        print("Error: Could not connect to RPC")
        sys.exit(1)

    account = w3.eth.account.from_key(PRIVATE_KEY)

    swap(
        w3=w3,
        account=account,
        from_token=FROM_TOKEN,
        to_token=TO_TOKEN,
        amount_wei=AMOUNT,
        slippage_bps=SLIPPAGE_BPS,
        fee_bps=FEE_BPS,
        fee_on_output=False,
        partner=PARTNER_ADDRESS,
        receiver=RECEIVER_ADDRESS,
    )


if __name__ == "__main__":
    main()
