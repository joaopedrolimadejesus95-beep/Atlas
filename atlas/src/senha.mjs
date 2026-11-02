import { randomBytes, scryptSync } from "node:crypto";

// Mesmo esquema do Vendly (src/auth.js): scrypt com salt, 64 bytes, em hex.
export function hashSenha(senha, salt) {
  return scryptSync(senha, salt, 64).toString("hex");
}

export function novoSalt() {
  return randomBytes(16).toString("hex");
}

// Senha aleatória por rodada: não existe credencial fixa de teste no repositório.
// Sempre >= 8 caracteres, pra passar na política de senha do Vendly.
export function gerarSenha() {
  return `Atlas-${randomBytes(9).toString("base64url")}`;
}
