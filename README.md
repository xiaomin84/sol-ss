# sol-ss

A Solana on-chain data storage program written in Rust for the smart contract, with TypeScript for deployment and interaction.

## Features

- ✅ On-chain data storage: Store arbitrary data on the Solana blockchain
- ✅ Data read/write: Complete functionality for saving, reading, and updating data
- ✅ PDA storage: Uses Program Derived Address (PDA) to create independent storage accounts for each user
- ✅ Multi-cluster support: Supports mainnet-beta, devnet, testnet, and localhost
- ✅ Automatic rent management: Intelligently handles account rent exemption and balance adjustments
- ✅ Modern toolchain: Uses Solana Kit v5 and TypeScript

## Project Structure

```
sol-ss/
├── src/
│   └── lib.rs              # Solana program entry point
├── scripts/
│   ├── deploy.ts           # Deployment script
│   └── interact.ts         # Interaction script (save/read/update data)
├── Cargo.toml              # Rust project configuration
├── package.json            # Node.js project configuration
└── README.md               # This file
```

## Prerequisites

### Required Tools

- [Rust](https://www.rust-lang.org/) (latest stable version)
- [Solana CLI](https://docs.solana.com/cli/install-solana-cli-tools) (v1.18.0 or higher)
- [Node.js](https://nodejs.org/) (v18.0.0 or higher)
- npm or yarn

### Install Solana CLI

```bash
sh -c "$(curl -sSfL https://release.solana.com/stable/install)"
```

### Verify Installation

```bash
solana --version
cargo --version
node --version
```

## Installation

1. Clone the project (if fetching from a repository)

2. Install Node.js dependencies:

```bash
npm install
```

3. Configure environment variables (optional)

Create a `.env` file:

```env
RPC_URL=https://api.devnet.solana.com
SOLANA_KEYPAIR=~/.config/solana/id.json
PROGRAM_ID=Your program ID (set after deployment)
```

## Usage Guide

### Build the Program

```bash
npm run build
# or
cargo build-sbf
```

The build artifact is located at `target/deploy/sol_ss.so`

### Deploy the Program

#### Basic Deployment (devnet)

```bash
npm run deploy
# or
npm run deploy:devnet
```

#### Deploy to Other Clusters

```bash
# Mainnet
npm run deploy:mainnet

# Local testnet
npm run deploy:localhost
```

#### Advanced Options

```bash
# View all options
npm run deploy:help

# Custom RPC and keypair
npm run deploy -- --cluster devnet --keypair ~/path/to/keypair.json

# Skip build, deploy only
npm run deploy -- --skip-build

# Upgrade existing program
npm run deploy -- --program-id <program-id>
```

### Interact with the Program

#### Save Data

```bash
npm run interact:save "Hello, Solana!"
# or
npm run interact -- save "Hello, Solana!"
```

#### Read Data

```bash
npm run interact:load
# or
npm run interact -- load
```

#### Update Data

```bash
npm run interact:update "Updated message"
# or
npm run interact -- update "Updated message"
```

#### Demo Full Workflow

```bash
npm run interact:demo
```

#### Custom Options

```bash
# Specify cluster and keypair
npm run interact -- save "message" --cluster devnet --keypair ~/path/to/keypair.json

# Specify program ID
npm run interact -- load --program-id <program-id>
```

## Program Description

### How It Works

1. **PDA Derivation**: The program derives a unique PDA for each user (based on user public key)
2. **Account Creation**: Creates a new account if it doesn't exist when saving for the first time
3. **Rent Management**: Automatically handles account rent exemption, ensuring the account has sufficient lamports
4. **Data Storage**: Stores data in the PDA account's data field
5. **Data Updates**: Supports updating existing data with automatic account size adjustment

### Account Structure

The program requires the following accounts:

- `user_account` (signer, writable): User account that pays transaction fees and rent
- `data_account` (writable): PDA account that stores user data
- `system_program`: Solana system program
- `rent_sysvar`: Rent system variable

### Instruction Data

The instruction data is directly the byte data the user wants to store, which can be any content (text, binary, etc.).

## Development

### Local Development

1. Start a local test validator:

```bash
solana-test-validator
```

2. Deploy to local in another terminal:

```bash
npm run deploy:localhost
```

3. Interact with the local program:

```bash
npm run interact -- save "test" --cluster localhost
```

### Testing

The program includes basic interaction tests that can verify functionality through the `interact:demo` command.

## Environment Variables

| Variable | Description | Default Value |
|----------|-------------|---------------|
| `RPC_URL` | Solana RPC endpoint | Auto-selected based on cluster |
| `SOLANA_KEYPAIR` | Keypair path for deployment/interaction | `~/.config/solana/id.json` |
| `PROGRAM_ID` | Program ID (set after deployment) | Built-in default value |

## Script Commands

### Build

- `npm run build` - Build Solana program

### Deploy

- `npm run deploy` - Deploy to devnet
- `npm run deploy:devnet` - Deploy to devnet
- `npm run deploy:mainnet` - Deploy to mainnet
- `npm run deploy:localhost` - Deploy to local testnet
- `npm run deploy:help` - Show deployment help

### Interact

- `npm run interact` - Interaction script (command required)
- `npm run interact:save <message>` - Save data
- `npm run interact:load` - Read data
- `npm run interact:update <message>` - Update data
- `npm run interact:demo` - Run demo

## Tech Stack

- **Smart Contract**: Rust + Solana Program v2
- **Deployment Tools**: TypeScript + Solana Kit v5
- **Interaction Tools**: TypeScript + Solana Kit v5

## Notes

1. **Mainnet Deployment**: Deploying to mainnet requires real SOL and careful operation
2. **Keypair Security**: Keep your keypair files secure and do not commit them to version control
3. **Program Upgrade**: Upgrading a program requires specifying the `--program-id` parameter
4. **Rent Exemption**: Accounts need sufficient lamports to pay for rent exemption

## License

This project is licensed under the MIT License.

## Contributing

Issues and Pull Requests are welcome.

## Related Links

- [Solana Documentation](https://docs.solana.com/)
- [Solana Program Documentation](https://docs.rs/solana-program/)
- [Solana Kit Documentation](https://solana-labs.github.io/solana-web3.js/)
