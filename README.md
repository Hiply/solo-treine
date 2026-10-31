# SYSTEM // Training Protocol

Aplicativo web (PWA) de treino e estudos gamificado, inspirado na linguagem visual de HUDs de RPG/anime — sem copiar assets ou identidade visual proprietária. Interface em pt-BR.

## O que existe hoje

- Dashboard de jogador, level, XP, rank e atributos (STR, VIT, AGI, END)
- Quests diárias, missão principal, streak, penalidades e achievements
- GPS do navegador com mapa Leaflet/OpenStreetMap e rota em tempo real
- **Conta local offline**: cadastro/login com e-mail e senha, progresso separado por jogador
- **Som do sistema** sintetizado via Web Audio API (sem arquivos externos) e avisos por voz opcionais
- **Acompanhamento real de estudos e treinos**: sessões registradas, check-in diário, cronômetro e histórico
- **MENTOR IA**: análise local, explicável e offline dos dados reais + integração opcional com IA generativa
- **Ranking global (multiplayer)**: comparação de XP, nível, rank, streak e minutos da semana com outros jogadores na nuvem
- **Device Sync**: importação de GPX/TCX/CSV/JSON do relógio e frequência cardíaca ao vivo por Web Bluetooth
- Exportação/importação do progresso em JSON
- Sincronização opcional com Supabase (nuvem)
- PWA instalável, com cache offline

## Rodar localmente

Requisitos: Node.js 18+ (recomendado) ou Python 3.

```bash
npm start
```

Abra `http://localhost:3000`.

Alternativa sem Node:

```bash
python -m http.server 8000
```

Abra `http://localhost:8000`.

> O GPS e o service worker exigem `localhost` ou HTTPS.

## Login e contas locais

O app funciona **sem internet e sem Supabase**:

1. Clique em **☁ CONTA** no topo.
2. Na aba **CONTA LOCAL**, informe nome, e-mail e senha (mínimo 6 caracteres).
3. Clique em **CRIAR CONTA** para o primeiro acesso ou **ENTRAR** para voltar depois.

Cada e-mail tem seu próprio progresso no `localStorage`:

- `system-training-v3:user:<email>` — estado do jogador
- `system-achievements:user:<email>` — conquistas
- `system-auth-profiles` — contas locais (hash SHA-256 da senha)
- `system-auth-session` — sessão atual

Use **EXPORTAR** e **IMPORTAR** na área da conta para backup ou transferência entre navegadores. A senha local é apenas uma proteção de perfil neste dispositivo; não é autenticação de servidor.

## Mentor IA: acompanhamento real

Abra a aba **MENTOR IA** para:

- **Registrar sessão** de estudo (matéria, tópico, minutos, foco) ou treino (atividade, minutos, intensidade)
- Fazer **check-in diário** de sono, humor e energia
- Usar o **cronômetro** e aplicar o tempo ao registro
- Ver **prontidão, estudo, treino, equilíbrio, consistência e recuperação**
- Receber **insights, recomendações e plano de 7 dias**

A análise local é determinística e usa somente os dados registrados. Ela calcula, entre outras métricas:

- volume de estudo e treino dos últimos 7 dias, com tendência vs. semana anterior
- carga aguda, carga crônica, ACWR, monotonia e strain
- foco médio, intensidade média, sono, humor e energia
- consistência, dias ativos, dias de descanso e sequência de treino
- distribuição por matéria e por atividade

**ACWR com histórico mínimo:** o índice só é exibido como confiável após 6 dias de treino nas últimas 4 semanas. Com poucos registros, o app mostra “ACWR em formação” em vez de gerar um falso alerta de sobrecarga.

### IA generativa (opcional)

A análise local sempre funciona. Para uma narrativa gerada por IA, há dois caminhos:

**1. Chave no navegador (mais simples)**

Abra **MENTOR IA → ⚙ CONFIGURAR IA**, escolha um provedor e informe a chave:

- OpenAI
- Groq (plano gratuito)
- Google Gemini
- OpenRouter
- Ollama local

A chave fica em `localStorage` neste navegador. Para uso público, prefira o proxy do servidor.

**2. Proxy no servidor (recomendado em produção)**

Defina as variáveis de ambiente antes de iniciar:

```powershell
$env:AI_API_KEY="sua-chave"
$env:AI_BASE_URL="https://api.openai.com/v1"
$env:AI_MODEL="gpt-4o-mini"
npm start
```

O servidor expõe:

- `GET /api/ai/status` — informa se o proxy está habilitado
- `POST /api/ai` — recebe `{ messages: [...] }` e devolve `{ text: "..." }`

A chave nunca vai para o navegador nesse modo. Sem `AI_API_KEY`, o proxy responde com uma mensagem amigável e a análise local continua disponível.

## Nuvem opcional (Supabase)

O login local não depende da nuvem. Para sincronizar entre aparelhos:

1. Crie um projeto gratuito em <https://supabase.com>.
2. No **SQL Editor**, execute `supabase-schema.sql`.
3. Em **Project Settings → API**, copie a **Project URL** e a **anon public key**.
4. Em `cloud-config.js`, preencha:
   ```js
   window.APP_PUBLIC_CONFIG = Object.freeze({
     supabaseUrl: 'https://SEU-PROJETO.supabase.co',
     supabaseAnonKey: 'SUA_CHAVE_PUBLICA_ANON'
   });
   ```
   A URL deve ser a base do projeto, **sem** `/rest/v1` no final. Use a chave pública **Publishable** (`sb_publishable_`) ou a chave legada `anon`; nunca publique `Secret` ou `service_role`.
5. Recarregue o app e use a aba **NUVEM** em **☁ CONTA**.

O app inclui teste de conexão e mensagens para projeto pausado, removido ou URL incorreta. A sincronização é “o mais recente vence” (last-write-wins).

> O app vem **sem** projeto Supabase configurado (URL e chave vazias): tudo funciona com a conta local e a aba RANKING mostra a simulação local. Preencha `cloud-config.js` com os dados do **seu** projeto para ativar nuvem, login online e ranking real.

## Ranking global (multiplayer)

A aba **RANKING** compara seu progresso com outros jogadores reais.

1. Execute `supabase-schema.sql` no **SQL Editor** do Supabase (ele cria `player_state` **e** `leaderboard`).
2. Entre pela aba **NUVEM** em **☁ CONTA**.
3. Na aba **RANKING**, escolha um **codinome** (até 32 caracteres) e mantenha **Participar do ranking global** marcado.
4. Clique em **PUBLICAR MEU RANK** ou apenas registre sessões: o app republica automaticamente.

O ranking publica somente: codinome, nível, rank, XP total, streak e minutos de estudo/treino da semana. A leitura é pública; cada conta só grava e apaga a própria linha (RLS). Desmarcar a participação remove sua linha da nuvem.

**Sem nuvem configurada**, a aba mostra uma **simulação local** com rivais fictícios, claramente marcados como `simulado`. Nada é enviado para lugar nenhum — é apenas para validar a interface.

## Device Sync (relógio, cinta de FC e arquivos)

A aba **SYNC** alimenta o app sem digitação manual.

### Web Bluetooth (frequência cardíaca ao vivo)

- Funciona em **Chrome/Edge no Android** ou desktop, em `localhost`/HTTPS.
- O sensor precisa expor o serviço padrão `heart_rate` (0x180D): cintas peitorais, relógios e anéis compatíveis.
- Clique em **CONECTAR FREQUÊNCIA CARDÍACA**, mantenha o sensor acordado e finalize em **DESCONECTAR**. Sessões com pelo menos 1 min viram treino real com FC média/máxima e calorias estimadas.

### Importação de arquivos

Arraste o arquivo na área de importação ou clique em **ESCOLHER ARQUIVO**:

| Formato | Origem típica | O que entra |
| --- | --- | --- |
| **GPX** | Garmin, Coros, Polar, Strava | Treino de corrida: data, duração, distância e FC (se houver) |
| **TCX** | Garmin, Polar | Treino: duração, distância, calorias e FC |
| **CSV** | Apple Saúde, Samsung, Xiaomi, Fitbit | Passos, calorias, sono, FC de repouso/média/máxima e treinos |
| **JSON** | exportações próprias e backups | Lista de dias/saúde e/ou lista de treinos |

Os dados entram em `state.health` (por dia) e `state.sessions` (treinos). A IA, o ranking e o restante do app passam a usá-los automaticamente. Treinos repetidos são ignorados por `externalId` e por data + minutos + distância + atividade.

Colunas reconhecidas no CSV (aceita cabeçalhos em pt-BR e inglês): `data/date`, `passos/steps`, `calorias/calories`, `horas_sono/sleep_hours`, `fc_repouso/resting_hr`, `fc_media/avg_hr`, `fc_maxima/max_hr`, `minutos/minutes`, `distancia/distance` (km), `distance_meters`, `atividade/activity`.

## Estrutura dos arquivos

| Arquivo | Função |
| --- | --- |
| `index.html` | estrutura das abas, modais de conta e IA |
| `style.css` | HUD, layout responsivo e estilos do Mentor |
| `app.js` | estado, XP, quests, GPS, histórico e persistência |
| `sound.js` | sons sintetizados e voz |
| `ai.js` | análise local e cliente de provedores compatíveis com OpenAI |
| `mentor.js` | UI do Mentor, sessões, check-in, cronômetro e chamadas de IA |
| `auth.js` | conta local, sessão, exportação/importação e login na nuvem |
| `cloud.js` | sincronização Supabase, ranking (fetch/push/remove), health check e erros amigáveis |
| `cloud-config.js` | URL Supabase e chave pública do projeto (configuração do deploy) |
| `leaderboard.js` | UI do ranking global, publicação do próprio rank e simulação local |
| `device.js` | Web Bluetooth (FC), importação GPX/TCX/CSV/JSON e saúde diária |
| `server.js` | servidor estático local + proxy de IA |
| `sw.js` | cache do PWA |
| `manifest.webmanifest` | metadados de instalação |
| `supabase-schema.sql` | tabela e políticas de acesso da nuvem |

## Limitações conhecidas

- A conta local protege contra acesso casual, não contra alguém com acesso ao navegador.
- A nuvem exige um projeto Supabase válido configurado em `cloud-config.js`.
- O GPS depende da permissão do navegador e de `localhost`/HTTPS.
- A IA generativa depende de chave/provedor externo; a análise local não.
- O ranking online depende de um projeto Supabase válido; sem ele, a aba mostra simulação local.
- O ranking não tem anti-cheat: os números são enviados pelo cliente. Para competição séria, valide no servidor (Edge Function) antes de publicar.
- Web Bluetooth exige Chrome/Edge (Android ou desktop) em `localhost`/HTTPS e um sensor com o serviço padrão de frequência cardíaca.
- A importação de arquivos depende do formato exportado pelo fabricante; formatos proprietários não listados podem precisar de conversão para GPX/TCX/CSV/JSON.
