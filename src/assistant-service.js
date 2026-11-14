import { Assistant } from './assistant.js';
import { CodexAssistant } from './codex-assistant.js';

export class AssistantService {
  constructor(stateDir,{openworker=new Assistant(stateDir),codex=new CodexAssistant(),defaultBackend=process.env.AI_BACKEND || 'openworker'}={}) {
    this.engines={openworker,codex};this.defaultBackend=defaultBackend;
    this.select(defaultBackend);
  }
  select(backend=this.defaultBackend){
    if(typeof backend!=='string' || !Object.hasOwn(this.engines,backend))throw new Error('Choose a supported assistant: openworker or codex.');
    return this.engines[backend];
  }
  get busy(){return Object.values(this.engines).some(engine=>engine.busy);}
  async getStatus(force=false){
    const codex=await this.engines.codex.refreshStatus(force);
    const openworker={id:'openworker',label:'OpenWorker (API / Ollama)',configured:this.engines.openworker.configured,
      message:this.engines.openworker.configured?'Ready. Uses your configured API or Ollama provider.':'Set AI_MODEL and an API key or local provider in .env to enable OpenWorker.'};
    return {ai:openworker.configured || codex.configured,aiDefaultBackend:this.defaultBackend,aiBackends:[openworker,codex]};
  }
  async shutdown(){await Promise.all(Object.values(this.engines).map(engine=>engine.shutdown()));}
}
