// Explicit saves + optimistic revisions. Never auto-publish a dirty browser buffer.
// JSON objects are unordered; schema validation may reorder their properties.
export const documentFingerprint=value=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
export class ProjectConnection {
  constructor({api,getDoc,replaceDoc,onChange=()=>{},beforeSave=async()=>{}}){Object.assign(this,{api,getDoc,replaceDoc,onChange,beforeSave,projectId:null,revision:0,base:'',busy:false,writing:false,epoch:0});}
  get dirty(){return this.projectId!==null&&documentFingerprint(this.getDoc())!==this.base;}
  async replaceSnapshot(document,options={}){this.applying=true;try{return await this.replaceDoc(document,options);}finally{this.applying=false;}}
  disconnect(){this.epoch++;this.projectId=null;this.base='';this.onChange();}
  async open(projectId){
    if(this.writing)throw Error('SAVE_IN_PROGRESS');
    const epoch=++this.epoch,before=documentFingerprint(this.getDoc()),r=await this.api('get_project',{projectId});
    if(epoch!==this.epoch)return false;
    if(documentFingerprint(this.getDoc())!==before)throw Error('LOCAL_CHANGED_DURING_OPEN');
    if(await this.replaceSnapshot(r.document,{resetHistory:this.projectId!==projectId})===false)throw Error('DOCUMENT_REJECTED');
    if(epoch!==this.epoch)return false;
    this.projectId=projectId;this.revision=r.revision;this.base=documentFingerprint(r.document);this.onChange();return true;
  }
  async create(projectId){
    if(this.writing)throw Error('SAVE_IN_PROGRESS');
    this.writing=true;
    const epoch=++this.epoch,document=structuredClone(this.getDoc());
    try{
      await this.beforeSave({projectId,revision:0,document});
      if(epoch!==this.epoch)return false;
      const r=await this.api('create_project',{projectId,document});
      if(epoch===this.epoch){
        // Adopt the saved snapshot without fetching/replacing the live editor.
        // Typing while the request is in flight must remain dirty and visible.
        this.projectId=projectId;this.revision=r.revision;this.base=documentFingerprint(r.document||document);
      }
      return r;
    }finally{this.writing=false;this.onChange();}
  }
  async save(){
    if(!this.projectId)throw Error('NOT_CONNECTED');if(this.writing)throw Error('SAVE_IN_PROGRESS');
    // A habitual Ctrl/Cmd+S must not invalidate a reviewed AI plan or proof.
    if(!this.dirty)return {projectId:this.projectId,revision:this.revision,unchanged:true};
    this.writing=true;
    // Invalidate reads already in flight as well as blocking new polls.
    // A pre-save response can arrive after this write has completed.
    const epoch=++this.epoch,projectId=this.projectId,revision=this.revision,document=structuredClone(this.getDoc());
    try{await this.beforeSave({projectId,revision,document});if(epoch!==this.epoch)return false;const r=await this.api('replace_project',{projectId,expectedRevision:revision,document});if(epoch===this.epoch){this.revision=r.revision;this.base=documentFingerprint(r.document||document);}return r;}finally{this.writing=false;this.onChange();}
  }
  async restore(revision){
    if(!this.projectId)throw Error('NOT_CONNECTED');if(this.writing)throw Error('SAVE_IN_PROGRESS');
    this.writing=true;const epoch=++this.epoch,before=documentFingerprint(this.getDoc());
    try{
      const r=await this.api('restore_version',{projectId:this.projectId,expectedRevision:this.revision,revision});
      if(epoch===this.epoch){
        if(documentFingerprint(this.getDoc())===before&&await this.replaceSnapshot(r.document)===false)throw Error('DOCUMENT_REJECTED');
        this.revision=r.revision;this.base=documentFingerprint(r.document);
      }
      return r;
    }finally{this.writing=false;this.onChange();}
  }
  async poll(){
    if(!this.projectId||this.busy||this.writing||this.dirty)return false;
    this.busy=true;const epoch=this.epoch,projectId=this.projectId;
    const interrupted=()=>epoch!==this.epoch||this.writing||this.dirty;
    try{
      const status=await this.api('get_project_status',{projectId});
      if(interrupted()||status.revision<=this.revision)return false;
      const r=await this.api('get_project',{projectId});
      if(interrupted()||r.revision<=this.revision)return false;
      if(await this.replaceSnapshot(r.document)===false)throw Error('DOCUMENT_REJECTED');
      if(epoch!==this.epoch)return false;
      this.revision=r.revision;this.base=documentFingerprint(r.document);this.onChange();return true;
    }finally{this.busy=false;}
  }
}
