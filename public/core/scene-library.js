export async function sceneRequest(url,method='GET',body) {
  const response=await fetch(url,{method,...(body ? {headers:{'Content-Type':'application/json'},body:JSON.stringify(body)} : {})});
  const data=await response.json();
  if(!response.ok)throw Object.assign(new Error(data.error?.message ?? data.error ?? `HTTP ${response.status}`),{status:response.status});
  return data;
}
export function createSceneLibrary({request=sceneRequest,onChange=()=>{}}={}) {
  let state={query:'',contentRating:'general',items:[],total:0,nextCursor:null,loading:false,error:''},epoch=0,disposed=false;
  const emit=()=>{if(!disposed)onChange(structuredClone(state));};
  async function load(more=false) {
    const version=++epoch;state.loading=true;state.error='';emit();
    try {
      const desired=more?60:Math.max(60,state.items.length);
      const params=new URLSearchParams({query:state.query,contentRating:state.contentRating,limit:String(Math.min(200,desired))});
      if(more&&state.nextCursor)params.set('cursor',state.nextCursor);
      const data=await request(`/api/v1/scenes?${params}`);
      while(!more&&data.nextCursor&&data.items.length<desired) {
        if(disposed||version!==epoch)return false;
        params.set('cursor',data.nextCursor);params.set('limit',String(Math.min(200,desired-data.items.length)));
        const next=await request(`/api/v1/scenes?${params}`);data.items.push(...next.items);data.nextCursor=next.nextCursor;
      }
      if(disposed||version!==epoch)return false;
      state={...state,...data,items:more?[...state.items,...data.items]:data.items,loading:false};emit();return true;
    }catch(error){
      if(disposed||version!==epoch)return false;
      if(more&&error.status===409)return load();
      state.loading=false;state.error=error.message;emit();return false;
    }
  }
  return {load,more:()=>state.nextCursor&&!state.loading?load(true):false,
    setQuery(patch){epoch++;state={...state,...patch,items:[],nextCursor:null};return load();},
    invalidate(){epoch++;state.loading=false;},
    getState:()=>structuredClone(state),dispose(){disposed=true;epoch++;}};
}
