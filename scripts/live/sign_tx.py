#!/usr/bin/env python3
"""
Single-responsibility EVM transaction signer.

Reads one unsigned legacy transaction as JSON from stdin:
  {"to": "0x...", "data": "0x...", "value": "0", "gas": 100000, "gasPrice": "50000000", "nonce": 0, "chainId": 56}

Signs it with the private key named by TALOE_TEST_WALLET_PRIVATE_KEY (read from
the environment, never from an argument, never logged) and writes exactly one
line of JSON to stdout: {"rawTransaction": "0x..."}.

This file touches the private key and nothing else: no business logic, no
Taloe decision-making, no network call. Keeping the signing surface this
small is deliberate — it is the only place in the whole project that ever
holds a real private key.
"""
import json
import os
import sys

from eth_account import Account


def main() -> None:
    private_key = os.environ.get("TALOE_TEST_WALLET_PRIVATE_KEY")
    if not private_key:
        print(json.dumps({"error": "TALOE_TEST_WALLET_PRIVATE_KEY is not set"}), file=sys.stderr)
        sys.exit(1)

    tx = json.load(sys.stdin)
    unsigned = {
        "to": tx["to"],
        "data": tx["data"],
        "value": int(tx["value"]),
        "gas": int(tx["gas"]),
        "gasPrice": int(tx["gasPrice"]),
        "nonce": int(tx["nonce"]),
        "chainId": int(tx["chainId"]),
    }
    signed = Account.sign_transaction(unsigned, private_key)
    raw_hex = signed.raw_transaction.hex()
    if not raw_hex.startswith("0x"):
        raw_hex = "0x" + raw_hex
    print(json.dumps({"rawTransaction": raw_hex}))

    # Defensively drop the reference before exit.
    del private_key


if __name__ == "__main__":
    main()
