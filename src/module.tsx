import React, { useEffect, useRef, useState } from 'react';
import { AppPlugin } from '@grafana/data';
import { config, getBackendSrv } from '@grafana/runtime';
import { Alert, Button, Field, Input, Select, Stack } from '@grafana/ui';

type FieldSpec = { name: string; label: string; type: 'string' | 'url' | 'integer' | 'number'; required: boolean; default: string; min?: number; max?: number };
type Scenario = { id: string; name: string; fields: FieldSpec[] };
type Catalog = { scenarios: Scenario[]; historyUrl?: string };
type State = { context?: { id: string; diagnosticUrl: string; endedAt?: string }; values?: Record<string,string>; phase: string; revision: string; scenario?: string; stats: { user_count: number; current_rps: number; fail_ratio: number }; message?: string };
const base = '/api/plugins/locust-control-app/resources';
const labels: Record<string,string> = { unavailable:'Indisponível', ready:'Pronto', starting:'Iniciando', running:'Executando', stopping:'Finalizando', finished:'Encerrado', error:'Erro' };
function errorMessage(error: unknown): string {
 if (typeof error === 'object' && error !== null && 'data' in error) {
  const data = error.data;
  if (typeof data === 'object' && data !== null && 'message' in data && typeof data.message === 'string') { return data.message; }
 }
 return 'Não foi possível consultar o runner. Aguarde a reconexão antes de enviar outro comando.';
}

function ControlPage() {
 const [catalog, setCatalog] = useState<Catalog>();
 const [scenarioId, setScenarioId] = useState('');
 const [values, setValues] = useState<Record<string,string>>({});
 const [state, setState] = useState<State>();
 const [error, setError] = useState('');
 const [pending, setPending] = useState(false);
 const submitting = useRef(false);
 const canCommand = config.bootData.user.isSignedIn && ['Editor','Admin'].includes(config.bootData.user.orgRole);
 const scenario = catalog?.scenarios.find(s => s.id === scenarioId);
 const ready = state && ['ready','finished'].includes(state.phase);
 const disabled = !canCommand || pending || !ready;

 useEffect(() => {
  let cancelled = false;
  getBackendSrv().get<Catalog>(base+'/catalog').then(result => {
   if (!cancelled) {
    setCatalog(result);
    const initial = result.scenarios[0];
    if (initial) { setScenarioId(initial.id); setValues(Object.fromEntries(initial.fields.map(f => [f.name, f.default]))); }
   }
  }).catch(e => { if (!cancelled) { setError(errorMessage(e)); } });
  let timer: ReturnType<typeof setTimeout>;
  async function poll() {
   try {
    const result = await getBackendSrv().get<State>(base+'/state');
    if (!cancelled) { setState(result); }
   } catch {
    if (!cancelled) { setState(previous => previous ? {...previous, phase:'unavailable'} : undefined); }
   } finally {
    if (!cancelled) { timer = setTimeout(poll, 1500); }
   }
  }
  void poll();
  return () => { cancelled = true; clearTimeout(timer); };
 }, []);

 useEffect(() => {
  if (state?.scenario && state.values && ['starting','running','stopping'].includes(state.phase)) {
   setScenarioId(state.scenario); setValues(state.values);
  }
 }, [state?.revision, state?.phase]);

 async function command(action: 'start' | 'stop') {
  if (submitting.current || !state) { return; }
  submitting.current = true; setPending(true); setError('');
  try {
   await getBackendSrv().post(base+'/'+action, {revision:state.revision, scenario:scenarioId, values:action === 'start' ? values : undefined});
  } catch (e) { setError(errorMessage(e)); }
  finally {
   try { setState(await getBackendSrv().get<State>(base+'/state')); } catch { setError('Runner indisponível. Aguarde a reconexão para conferir o resultado do comando.'); }
   submitting.current = false; setPending(false);
  }
 }

 return <section aria-label="Controle Locust" style={{padding:'24px', maxWidth:'760px'}}>
  <h1>Novo teste</h1>
  <p>Configure o cenário e acompanhe a execução neste runner.</p>
  {!canCommand && <Alert title="Entre como Editor ou Admin para iniciar ou parar um teste." severity="info" />}
  {error && <div role="alert"><Alert title="Não foi possível concluir a operação" severity="error">{error}</Alert></div>}
  <section aria-label="Estado do runner">
   <p role="status"><strong>{labels[state?.phase ?? 'unavailable'] ?? state?.phase}</strong>{pending ? ' · Enviando comando…' : ''}</p>
   {state?.message && <Alert title="Verifique o runner" severity="warning">{state.message}</Alert>}
   {state && <p>Usuários: {state.stats.user_count} · Requisições/s: {state.stats.current_rps.toFixed(1)} · Falhas: {(state.stats.fail_ratio*100).toFixed(1)}%</p>}
  </section>
  {!catalog ? <p>Carregando cenários…</p> : catalog.scenarios.length === 0 ? <Alert title="Nenhum cenário configurado" severity="warning" /> :
   <form aria-label="Configuração do teste" method="post" action={base+'/start'} onSubmit={e => {e.preventDefault(); void command('start');}}>
    <Field label="Cenário" htmlFor="locust-scenario">
     <Select inputId="locust-scenario" name="scenario" disabled={disabled} value={scenarioId} options={catalog.scenarios.map(s => ({label:s.name,value:s.id}))}
      onChange={option => {const id=option.value ?? ''; setScenarioId(id); setValues(Object.fromEntries((catalog.scenarios.find(s => s.id===id)?.fields ?? []).map(f => [f.name,f.default])));}} />
    </Field>
    {scenario?.fields.map(field => <Field key={field.name} label={field.label+(field.required ? ' *' : '')} htmlFor={'locust-'+field.name}>
     <Input id={'locust-'+field.name} name={field.name} disabled={disabled} required={field.required} maxLength={2048}
      type={field.type==='integer'||field.type==='number' ? 'number' : field.type==='url' ? 'url' : 'text'}
      min={field.min} max={field.max} step={field.type==='integer' ? 1 : 'any'} value={values[field.name] ?? ''}
      spellCheck={false} onChange={e => setValues({...values,[field.name]:e.currentTarget.value})} />
    </Field>)}
    <Stack gap={2}>
     <Button type="submit" disabled={disabled}>Iniciar teste</Button>
     <Button type="button" variant="destructive" disabled={!canCommand || pending || state?.phase!=='running'} onClick={() => void command('stop')}>Parar teste</Button>
    </Stack>
   </form>}
  {state?.context?.diagnosticUrl && <p><a href={state.context.diagnosticUrl}>Abrir diagnóstico desta execução</a></p>}
  {state?.phase==='starting' && <p>Aguardando confirmação do runner e da identidade da nova execução.</p>}
  {catalog?.historyUrl && <p><a href={catalog.historyUrl}>Consultar histórico</a></p>}
 </section>;
}
export const plugin = new AppPlugin().setRootPage(ControlPage);
