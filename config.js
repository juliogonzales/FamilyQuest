/* FamilyQuest — configuração da nuvem (Supabase)
   Cole abaixo os dois valores do seu projeto (Supabase → Project Settings → API).
   A chave "anon public" (ou "publishable") foi feita para ficar no app: ela NÃO dá acesso de administrador.
   Enquanto estiver como "COLE_AQUI", o app funciona só no aparelho, sem contas. */
window.FQ_CONFIG = {
  SUPABASE_URL: 'COLE_AQUI',        // ex.: https://abcdefgh.supabase.co
  SUPABASE_ANON_KEY: 'COLE_AQUI',   // ex.: eyJhbGciOi... (chave anon/publishable)
};
