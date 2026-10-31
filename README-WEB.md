# SYSTEM // Training Protocol — versão web/mobile + nuvem opcional

## O que muda nesta versão

- Site estático gratuito no Cloudflare Pages, instalável como app (PWA). O repositório pode permanecer privado no GitHub.
- **Conta local offline**: login por e-mail e senha, com progresso separado por jogador. Não precisa de Supabase nem de internet.
- **Som do sistema** gerado no navegador (Web Audio API), sem arquivos de áudio externos.
- **Acompanhamento real** de estudo e treino: sessões, check-in de sono/humor/energia, cronômetro e histórico.
- **MENTOR IA** com análise local explicável e, opcionalmente, narrativa de IA generativa.
- **Ranking global (multiplayer)**: comparação online de XP, nível, rank, streak e minutos da semana.
- **Device Sync**: importação de GPX/TCX/CSV/JSON do relógio e frequência cardíaca ao vivo por Web Bluetooth.
- **Sincronização opcional** entre PC e celular com [Supabase](https://supabase.com) (plano gratuito).
- Sem conta configurada, o app funciona normalmente salvando no `localStorage`.

## Custo

Zero, dentro dos limites do plano gratuito do Supabase (por projeto):

- 500 MB de banco de dados
- 50.000 usuários autenticados/mês
- 1 GB de armazenamento de arquivos
- **Atenção:** um projeto gratuito “pausa” sozinho após 7 dias sem uso. Os dados não são apagados — basta entrar no painel do Supabase e clicar em “Restore project”.

## Publicação — Cloudflare Pages (frontend, grátis)

O site é estático e não precisa de etapa de build. O Cloudflare Pages pode acompanhar um repositório privado do GitHub e publicar cada atualização enviada para a branch principal.

1. Crie um repositório **privado** no GitHub e envie a pasta do projeto, incluindo `assets/` e `cloud-config.js`.
2. No Cloudflare, abra **Workers & Pages** → **Create application** → **Pages** → **Connect to Git** e autorize o repositório.
3. Configure a branch de produção como `main`, deixe o comando de build vazio e use `.` como diretório de saída.
4. Clique em **Save and Deploy**. O site ficará disponível em um endereço `*.pages.dev` com HTTPS.
5. Depois, cada atualização enviada à branch `main` será publicada automaticamente.
6. No celular, permita localização quando o navegador pedir; em navegadores compatíveis, use “instalar” / “adicionar à tela inicial”.

O site pode ficar público enquanto o código permanece em um repositório privado. O Cloudflare Pages publica os arquivos estáticos; o Supabase abaixo fornece as contas e o placar compartilhado.

## Conta local (funciona offline)

No topo do app, clique em **☁ CONTA** → aba **CONTA LOCAL**:

- **CRIAR CONTA**: nome, e-mail e senha (mínimo 6 caracteres)
- **ENTRAR**: e-mail e senha já cadastrados neste navegador
- **SAIR**: encerra a sessão sem apagar o progresso
- **EXPORTAR / IMPORTAR**: backup do progresso em JSON

O progresso de cada jogador fica separado no `localStorage`. A senha é armazenada como hash SHA-256 e serve como proteção de perfil local, não como autenticação de servidor.

## Mentor IA (estudos e treinos)

Na aba **MENTOR IA**:

- registre sessões de estudo ou treino;
- faça o check-in diário de sono, humor e energia;
- use o cronômetro;
- veja prontidão, estudo, treino, equilíbrio, consistência e recuperação;
- receba insights, recomendações e um plano de 7 dias.

A análise local é offline e usa apenas dados reais registrados. O ACWR só é considerado confiável após 6 dias de treino nas últimas 4 semanas; antes disso o app mostra “ACWR em formação” para evitar falsos alertas.

### IA generativa (opcional)

**No navegador:** **MENTOR IA → ⚙ CONFIGURAR IA**, escolha OpenAI, Groq, Gemini, OpenRouter ou Ollama e informe a chave. A chave fica no `localStorage` deste navegador.

**No servidor (recomendado para uso público):** rode `npm start` com as variáveis:

```powershell
$env:AI_API_KEY="sua-chave"
$env:AI_BASE_URL="https://api.openai.com/v1"
$env:AI_MODEL="gpt-4o-mini"
npm start
```

Endpoints do proxy:

- `GET /api/ai/status`
- `POST /api/ai` com `{ "messages": [...] }`

Sem chave, o proxy responde com erro amigável e a análise local continua funcionando.

## Passo a passo — Supabase (contas + ranking global)

1. Crie uma conta gratuita em <https://supabase.com> e clique em **New project**.
2. Escolha uma senha de banco (guarde-a) e aguarde o projeto ser criado (~2 min).
3. No menu lateral, abra **SQL Editor** → **New query**, cole o conteúdo de `supabase-schema.sql` e clique em **Run**.
4. Para que qualquer pessoa possa criar conta sem configurar um servidor de e-mail pago, abra **Authentication → Sign In / Providers → Email** e desative **Confirm email**. Nesse modo, o cadastro entra sem confirmação de endereço; escolha uma senha exclusiva. Se preferir confirmação por e-mail, configure um SMTP próprio: o remetente padrão gratuito do Supabase não envia livremente para todos os usuários.
5. Em **Project Settings → API Keys**, copie **Project URL** e a chave **Publishable** (`sb_publishable_`). A chave legada **anon** também funciona. Nunca copie a chave **Secret** ou `service_role`.
6. Abra `cloud-config.js` e preencha os dois campos:
   ```js
   window.APP_PUBLIC_CONFIG = Object.freeze({
     supabaseUrl: 'https://SEU-PROJETO.supabase.co',
     supabaseAnonKey: 'SUA_CHAVE_PUBLICA_ANON'
   });
   ```
7. Envie `cloud-config.js` atualizado para o repositório e aguarde a publicação automática.
8. No site, abra **☁ CONTA → NUVEM**, teste a conexão e crie sua conta online.

O projeto já inclui `supabase-schema.sql`, com as tabelas de sincronização, ranking público e políticas de acesso. O app vem sem credenciais do Supabase: antes de conectar o projeto e executar o SQL, o ranking usa somente dados locais de demonstração.

**Segurança:** a chave **Publishable** foi feita para uso no navegador, com as políticas RLS do schema. O nome `supabaseAnonKey` no arquivo é apenas o nome do campo; nele pode ser usada a chave Publishable. Nunca coloque a chave **Secret** ou `service_role` em `cloud-config.js` ou em qualquer arquivo publicado.

## Ranking global (multiplayer)

Depois de rodar `supabase-schema.sql` e entrar na aba **NUVEM**:

1. Abra a aba **RANKING**.
2. Defina um **codinome** e mantenha **Participar do ranking global** marcado.
3. Clique em **PUBLICAR MEU RANK** (ou apenas registre sessões; o app republica sozinho).

A tabela `leaderboard` é pública para leitura e cada conta só grava/apaga a própria linha. Só são publicados codinome, nível, rank, XP, streak e minutos da semana. Desmarcar a participação remove sua linha da nuvem.

Sem Supabase configurado, a aba exibe uma **simulação local** com rivais fictícios marcados como `simulado` — nada é enviado para a internet. Com o Supabase ativo, qualquer visitante pode ler o ranking e cada usuário autenticado pode publicar apenas a própria ficha. Por padrão, a participação está ativada; o jogador pode desativá-la na tela de ranking, o que remove sua ficha pública.

## Device Sync (relógio e sensores)

Na aba **SYNC**:

- **Web Bluetooth**: conecte uma cinta/relógio com o serviço padrão `heart_rate` (0x180D) para ver FC ao vivo, zonas, média/mínima/máxima e finalizar a sessão como treino real. Requer Chrome/Edge no Android (ou desktop) e HTTPS — o Cloudflare Pages já fornece HTTPS.
- **Importar arquivo**: arraste GPX/TCX (treinos de Garmin, Coros, Polar, Strava) ou CSV/JSON (Apple Saúde, Samsung, Xiaomi, Fitbit) para preencher passos, calorias, sono, FC e treinos sem digitar nada.
- Treinos repetidos são ignorados automaticamente (deduplicação por `externalId` e por data + minutos + distância + atividade).

Os dados importados alimentam a IA, o ranking e o histórico.

## Limitações

- A conta local não substitui autenticação de servidor.
- A nuvem exige um projeto Supabase válido e configurado em `cloud-config.js`.
- O GPS exige HTTPS (Cloudflare Pages já fornece) e permissão do navegador.
- A sincronização é “o mais recente vence” (last-write-wins).
- A IA generativa depende de provedor/chave externos; a análise local não.
- O ranking online depende de um projeto Supabase válido; sem ele, a aba mostra simulação local.
- O ranking não tem anti-cheat: os números vêm do cliente. Para competição séria, valide no servidor.
- Web Bluetooth exige Chrome/Edge (Android ou desktop) em HTTPS e um sensor com o serviço padrão de FC.
- A importação depende do formato exportado pelo fabricante; formatos não listados podem precisar de conversão.

## Próxima arquitetura (opcional, ainda sem custo)

O ranking atual limita cada conta à própria linha, mas os números ainda vêm do navegador e podem ser manipulados. Para uma competição com resultados auditáveis e anti-cheat, será necessário validar as recompensas no servidor com uma Edge Function. O `server.js` deste projeto continua útil para desenvolvimento local (`npm start`) e como proxy opcional de IA.
