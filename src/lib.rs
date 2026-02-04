#![allow(unexpected_cfgs)]
// system_instruction 已弃用，官方建议用 solana_system_interface；但该 crate 与 solana-program 2 类型不兼容（Address vs Pubkey、Instruction 版本不同），故仍使用此处 API 并屏蔽警告
#![allow(deprecated)]

use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    program::invoke_signed,
    program_error::ProgramError,
    pubkey::Pubkey,
    rent::Rent,
    system_program,
    system_instruction,
    sysvar::{self, Sysvar},
};

solana_program::entrypoint!(process_instruction);

/// Maximum allowed data size (10 KB)
const MAX_DATA_SIZE: usize = 10 * 1024;

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    // Security: Validate input data size to prevent DoS attacks
    if data.len() > MAX_DATA_SIZE {
        return Err(ProgramError::InvalidInstructionData);
    }

    let accounts_iter = &mut accounts.iter();
    
    // Extract accounts
    let user_account = next_account_info(accounts_iter)?;
    let data_account = next_account_info(accounts_iter)?;
    let system_program_account = next_account_info(accounts_iter)?;
    let rent_sysvar_account = next_account_info(accounts_iter)?;

    // Security: Verify user_account is a signer
    if !user_account.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Security: Verify accounts have correct permissions
    if !user_account.is_writable {
        return Err(ProgramError::InvalidAccountData);
    }
    if !data_account.is_writable {
        return Err(ProgramError::InvalidAccountData);
    }

    // Security: Verify system program account
    if system_program_account.key != &system_program::ID {
        return Err(ProgramError::IncorrectProgramId);
    }

    // Security: Verify rent sysvar account
    if rent_sysvar_account.key != &sysvar::rent::ID {
        return Err(ProgramError::IncorrectProgramId);
    }

    // Calculate rent exemption for the data size
    let rent_exemption = Rent::get()?.minimum_balance(data.len());
    
    // Derive PDA and verify it matches the provided data_account
    let (pda, bump_seed) =
        Pubkey::find_program_address(&[user_account.key.as_ref()], program_id);

    if pda != *data_account.key {
        return Err(ProgramError::InvalidSeeds);
    }

    // Prepare signer seeds for PDA operations
    let signer_seeds: &[&[u8]] = &[user_account.key.as_ref(), std::slice::from_ref(&bump_seed)];

    // If account doesn't exist, create it
    if data_account.lamports() == 0 {
        invoke_signed(
            &system_instruction::create_account(
                user_account.key,
                data_account.key,
                rent_exemption,
                data.len() as u64,
                program_id,
            ),
            accounts,
            &[signer_seeds],
        )?;
        data_account.try_borrow_mut_data()?.copy_from_slice(data);
        return Ok(());
    }

    // Handle rent exemption: if account needs more lamports, transfer from user
    if rent_exemption > data_account.lamports() {
        // Security: Use checked arithmetic to prevent underflow
        let additional_lamports = rent_exemption
            .checked_sub(data_account.lamports())
            .ok_or(ProgramError::ArithmeticOverflow)?;
        
        solana_program::program::invoke(
            &system_instruction::transfer(
                user_account.key,
                data_account.key,
                additional_lamports,
            ),
            accounts,
        )?;
    }

    // Handle rent exemption: if account has excess lamports, return to user
    if rent_exemption < data_account.lamports() {
        // Security: Use checked arithmetic to prevent underflow
        let excess = data_account
            .lamports()
            .checked_sub(rent_exemption)
            .ok_or(ProgramError::ArithmeticOverflow)?;
        
        **user_account.lamports.borrow_mut() += excess;
        **data_account.lamports.borrow_mut() = rent_exemption;
    }

    // Resize account if needed and update data
    data_account.resize(data.len())?;
    data_account.try_borrow_mut_data()?.copy_from_slice(data);

    Ok(())
}

