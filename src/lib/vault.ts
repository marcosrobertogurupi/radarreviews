// Helpers para o Supabase Vault
// Tokens OAuth (Facebook, Instagram, Reddit) ficam criptografados no Vault.
// O campo vault_secret_id em channel_connectors guarda apenas a referência (UUID).

import { supabase } from './supabase.js'

/**
 * Recupera um segredo criptografado do Supabase Vault pelo UUID.
 * Usado para tokens OAuth de canais que exigem autorização do cliente.
 *
 * @param secretId - UUID do segredo armazenado em vault.secrets
 * @returns O valor do segredo em texto plano
 * @throws Error se o segredo não existir ou houver falha de acesso
 */
export async function getVaultSecret(secretId: string): Promise<string> {
  const { data, error } = await supabase
    .schema('vault')
    .from('decrypted_secrets')
    .select('decrypted_secret')
    .eq('id', secretId)
    .single()

  if (error || !data) {
    throw new Error(
      `Vault: não foi possível recuperar o segredo ${secretId}. ${error?.message ?? 'Sem dados retornados.'}`
    )
  }

  const secret = (data as Record<string, unknown>)['decrypted_secret']
  if (typeof secret !== 'string' || !secret) {
    throw new Error(`Vault: segredo ${secretId} está vazio ou em formato inválido.`)
  }

  return secret
}

/**
 * Armazena um novo segredo criptografado no Supabase Vault.
 * Retorna o UUID do segredo para ser salvo em channel_connectors.vault_secret_id.
 *
 * @param name - Nome descritivo do segredo (ex: "facebook_token_tenant_abc")
 * @param secret - Valor do segredo em texto plano (será criptografado)
 * @returns UUID do segredo criado no Vault
 * @throws Error se não for possível salvar o segredo
 */
export async function setVaultSecret(name: string, secret: string): Promise<string> {
  const { data, error } = await supabase.rpc('vault_create_secret', {
    secret,
    name,
  })

  if (error || !data) {
    throw new Error(
      `Vault: não foi possível salvar o segredo "${name}". ${error?.message ?? 'Sem dados retornados.'}`
    )
  }

  return String(data)
}
