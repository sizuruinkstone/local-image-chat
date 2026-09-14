// Server-backed catalog. Active profile snapshots remain owned by the draft.
export function createSharedSectionProfileLibrary({transport,storage}){
 let items=[],revision=0;
 const normalize=p=>({...p,contentRating:p?.contentRating==='nsfw'?'nsfw':'general'});
 async function request(path='',method='GET',body){
  const response=await transport.fetch(`/api/v1/section-profiles${path}`,{method,headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const data=await response.json();if(!response.ok)throw new Error(data.error?.message||'プロファイルサーバーに接続できません');return data;
 }
 const library={
  list:()=>structuredClone(items),
  async refresh(){const token=++revision;const data=await request();if(token===revision)items=data.profiles.map(normalize);return library.list();},
  async initialize(){
   let profiles=[],hidden=[];
   try{const saved=JSON.parse(storage.getItem('localImageChat.sectionProfiles.v1')||'[]');if(Array.isArray(saved))profiles=saved;}catch{/* Preserve damaged local storage. */}
   try{const saved=JSON.parse(storage.getItem('localImageChat.sectionProfileSamplesHidden.v1')||'[]');if(Array.isArray(saved))hidden=saved;}catch{/* Optional preferences. */}
   await request('/import','POST',{profiles,hidden});await library.refresh();
  },
  async save(field,value){const result=await request('','POST',{field,name:value.name,text:value.text,contentRating:value.contentRating});const profile=normalize(result.profile);revision++;items=[profile,...items.filter(item=>item.id!==profile.id)];return profile;},
  async remove(id){await request(`/${encodeURIComponent(id)}`,'DELETE');revision++;items=items.filter(p=>p.id!==id);}
 };return library;
}
