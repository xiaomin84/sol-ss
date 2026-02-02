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
    system_instruction,
    sysvar::Sysvar,
};

solana_program::entrypoint!(process_instruction);

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();
    let user_account = next_account_info(accounts_iter)?;
    let data_account = next_account_info(accounts_iter)?;
    let _system_program = next_account_info(accounts_iter)?;
    let _rent_sysvar = next_account_info(accounts_iter)?;

    let rent_exemption = Rent::get()?.minimum_balance(data.len());
    let (pda, bump_seed) =
        Pubkey::find_program_address(&[user_account.key.as_ref()], program_id);

    if pda != *data_account.key {
        return Err(ProgramError::InvalidSeeds);
    }

    let signer_seeds: &[&[u8]] = &[user_account.key.as_ref(), std::slice::from_ref(&bump_seed)];

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

    if rent_exemption > data_account.lamports() {
        solana_program::program::invoke(
            &system_instruction::transfer(
                user_account.key,
                data_account.key,
                rent_exemption - data_account.lamports(),
            ),
            accounts,
        )?;
    }

    if rent_exemption < data_account.lamports() {
        let excess = data_account.lamports() - rent_exemption;
        **user_account.lamports.borrow_mut() += excess;
        **data_account.lamports.borrow_mut() = rent_exemption;
    }

    data_account.resize(data.len())?;
    data_account.try_borrow_mut_data()?.copy_from_slice(data);

    Ok(())
}

