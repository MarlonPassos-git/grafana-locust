# Grafana Locust

App plugin para controlar um runner Locust pelo Grafana. Em More apps → Locust, **Execuções** abre o controle e a lista salva; **Nova execução** apresenta o formulário e os perfis à direita. A interface React e o
backend Go foram validados com Grafana 13.2.5, Locust 2.47.0 e SDK Go v0.298.0.

O pacote `internal/runner` adapta a API HTTP nativa do Locust:
`GET /stats/requests`, `POST /swarm` e `POST /stop`. O endereço é definido
pelo servidor, sem credenciais na URL. Comandos usam formulário e exigem
`success:true`; não seguem redirects nem repetem tentativas. Erros não
incluem corpos de resposta ou parâmetros enviados.

O controlador reserva o runner antes de iniciar, rejeita comandos com revisão
antiga e recupera o estado do runner pela API. Um comando de resultado ambíguo
mantém a reserva até observar a execução ativa e seu encerramento. Não há
reenvio automático. Isso pode exigir intervenção do operador quando a requisição
não chegou ao runner. Nesse caso, confira no runner que não há carga nem
requisição de início pendente antes de recriar o backend Grafana. O plugin
não repete o POST. A revisão local de controle não é um ID persistido do Locust.

As rotas de recursos são `GET /catalog`, `GET /state`, `GET /recent`, `POST /start` e
`POST /stop`. Comandos exigem a identidade Editor/Admin autenticada enviada pelo
Grafana via SDK. Cabeçalhos do navegador não concedem permissão. O corpo contém
`revision` obtida de `/state`; iniciar também recebe `scenario` e `values`.
Campos desconhecidos são rejeitados.

## Verificação em container

Requer Docker, sem Go instalado no host:

```sh
docker run --rm --user "$(id -u):$(id -g)" \
  -e GOPATH=/tmp/go-work -e GOCACHE=/tmp/go-cache -v "$PWD:/src" -w /src \
  golang:1.27.3-bookworm \
  sh -c 'gofmt -l cmd internal && go test -race ./internal/... && go vet ./internal/... && go build ./cmd/plugin'
```

Os testes usam somente servidores HTTP locais simulados.

## Configuração do backend

`jsonData` do provisionamento do App:

```json
{
  "runnerUrl": "http://locust:8089",
  "scenarios": [{
    "id": "native",
    "name": "HTTP",
    "fixed": {},
    "fields": [
      {"name": "host", "label": "Host", "type": "url", "required": true, "default": "http://target"},
      {"name": "user_count", "label": "Users", "type": "integer", "required": true, "default": "1", "min": 1},
      {"name": "spawn_rate", "label": "Users/s", "type": "number", "required": true, "default": "1", "min": 0.01},
      {"name": "run_time", "label": "Duration", "type": "string", "default": "10s"}
    ]
  }]
}
```

Campos usam os nomes nativos/customizados esperados por `/swarm`.
`fixed` contém parâmetros não editáveis, como seleção de classe/shape quando
o runner usa `--class-picker`. Campos editáveis podem ser `string`, `url`,
`integer` ou `number`, com `required`, `default`, `min` e `max`.
Use `options: [{"label": "Pix", "value": "125"}, {"label": "Boleto", "value": "6"}]` para expor um campo como escolhas visíveis. O backend valida o valor contra as opções registradas, além do tipo e dos limites. As regras de negócio adicionais continuam no cenário Locust.

Perfis compartilhados são definidos em `jsonData.profiles`:

```json
[{"id": "gradual", "name": "Carga gradual", "scenario": "native", "values": {"user_count": "3", "spawn_rate": "1"}}]
```

Cada perfil referencia um cenário existente e apenas campos editáveis registrados. Campos omitidos recebem seus padrões; campos inválidos ou desconhecidos impedem carregar a configuração. Selecionar um perfil preenche o formulário; o usuário pode editar antes de clicar em Iniciar execução.

Os fontes estão em https://github.com/MarlonPassos-git/grafana-locust.
Para obter o exemplo independente:

```sh
git clone https://github.com/MarlonPassos-git/grafana-locust.git
cd grafana-locust/examples/native
```

O exemplo independente e a integração checkout foram validados localmente.
O plugin não tem assinatura nem publicação no catálogo Grafana.
A licença de distribuição ainda não foi definida.

## Exemplo independente

Em `examples/native`, configure `GRAFANA_ADMIN_PASSWORD` e execute:

```sh
docker compose up -d --build
```

O Grafana fica em http://localhost:3100/a/locust-control-app. Entre com
`admin` e a senha configurada para controlar o runner. O Compose inicia em
espera, sem enviar carga. O alvo é um nginx interno; Locust e alvo não publicam
portas no host. Os cenários rápido e gradual são definidos no provisionamento,
sem alterar o código do plugin.

A imagem usa estágios Node 24.22.1 e Go 1.27.3. O plugin fica em
`/opt/grafana/plugins`, fora do volume padrão `/var/lib/grafana`.
A exceção de assinatura fica restrita a `locust-control-app`.

O build empacota `plugin.json` com a versão base e um sufixo calculado pelo
SHA-256 de `module.js`. Como o Grafana usa a versão na chave de cache do
JavaScript, alterações do frontend recebem uma URL nova após reconstruir a
imagem e recriar o Grafana. Recarregue a página para carregar os novos metadados.
O manifesto-fonte mantém a versão base; nenhum dado de execução entra no hash.

## Contexto opcional

Configure `contextPath` com um caminho no runner, por exemplo
`/execution-context`. O endpoint deve retornar JSON com `id`, `startedAt`,
`endedAt` nulo enquanto ativo e preenchido após finalizar persistência/relatórios,
`diagnosticUrl`, `scenario` e `values` opcionais.
A identidade pertence ao consumidor. O controlador descarta o contexto do
lote anterior após Iniciar e aguarda uma identidade nova antes de mostrar
o relatório. Sem esse endpoint, o controle nativo continua funcionando.

## Histórico opcional para reutilização

Configure `recentPath`, por exemplo `/recent-executions`, com um caminho no runner que retorne:

```json
{"executions": [{"id": "2026-11-10T18:00:00+00:00", "startedAt": "2026-11-10T18:00:00+00:00", "diagnosticUrl": "/d/report?run=example", "scenario": "native", "values": {"host": "http://target", "user_count": "3"}, "passed": true}]}
```

O plugin envia `?page=0` (inteiro entre 0 e 1000000), incrementado pela paginação. O consumidor consulta seu histórico persistido, incluindo execuções ativas, e retorna uma página ordenada da mais recente para a mais antiga, com `hasMore: true` quando houver outra página. `endedAt` é nulo enquanto a execução não terminou; `passed` pode ser nulo. A integração checkout usa páginas de 20. Não há limite de três registros no plugin.

**Reutilizar configuração** abre Nova execução com os campos atuais do cenário e seus padrões para revisão. O início é explícito. Sem `recentPath`, Execuções informa que não há histórico configurado e mantém o controle nativo. Falhas de consulta permitem tentar novamente. O runner ativo aparece acima da lista com **Parar execução**; formulário e perfis ficam bloqueados até concluir a finalização, preservando os valores preenchidos.

Após iniciar com sucesso, o app aguarda um `contextPath` com ID diferente do anterior para redirecionar ao `diagnosticUrl`. Erros não causam redirecionamento nem repetição automática. Sem contexto opcional, o início confirmado pelo runner abre Execuções para acompanhamento e parada. Recarregar a página não reenvia comandos.

Limites: uma instância Grafana, um runner, sem HA ou alterações externas
simultâneas no runner. O plugin não persiste métricas nem executa scripts enviados
pelo navegador. O consumidor mantém cenários e histórico.

## Verificação do frontend

Use Node 24 em container na raiz do plugin:

```sh
docker run --rm --user "$(id -u):$(id -g)" \
  -e npm_config_cache=/tmp/npm -v "$PWD:/src" -w /src \
  node:24.22.1-bookworm-slim \
  sh -c 'npm ci --no-audit --no-fund && npm run lint && npm test && npm run typecheck && npm run build'
```

`npm run lint` verifica formato e regras estáticas; `npm run format` aplica
o formatter. A imagem executa lint, testes, typecheck e build do frontend.

Para runners com `--class-picker`, selecione a classe e a shape no catálogo,
por exemplo `"fixed": {"user_classes": "Visitor", "shape_class": "Default"}`.
Uma shape própria usa o nome registrado no runner em vez de `Default`.
O runner mantém os scripts e suas regras de negócio.
