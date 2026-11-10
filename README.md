# Grafana Locust

App plugin para controlar um runner Locust pelo Grafana. A interface React e o
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

As rotas de recursos são `GET /catalog`, `GET /state`, `POST /start` e
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
As regras de negócio adicionais continuam no cenário Locust.

O exemplo independente e a integração checkout foram validados localmente.
Remoto, assinatura, licença de distribuição e publicação serão definidos antes
de distribuição pública.

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

## Contexto opcional

Configure `contextPath` com um caminho no runner, por exemplo
`/execution-context`. O endpoint deve retornar JSON com `id`, `startedAt`,
`endedAt` nulo enquanto ativo e preenchido após finalizar persistência/relatórios,
`diagnosticUrl`, `scenario` e `values` opcionais.
A identidade pertence ao consumidor. O controlador descarta o contexto do
lote anterior após Iniciar e aguarda uma identidade nova antes de mostrar
o relatório. Sem esse endpoint, o controle nativo continua funcionando.

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
