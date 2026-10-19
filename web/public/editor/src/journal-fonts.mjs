// Shared by the native runtime and browser. Never silently replace a font profile.
export function journalFontProblems(document, inventory){
 if(!inventory?.profiles)return [];
 const j=document.journal||{},choices={cjk:document.layout?.fontSet||inventory.defaultCjkFontSet||'windows',latin:j.latinFont||'tex-default',math:j.mathFont||'tex-default',bodyWeight:j.bodyWeight||'regular'};
 const problems=[];
 for(const [category,key] of Object.entries(choices)){
  const profile=inventory.profiles[category]?.[key];
  if(!profile?.available)problems.push({category,profile:key,missingFonts:profile?.missingFonts||[],message:`${category}/${key}：缺少 ${(profile?.missingFonts||[]).join('、')||'已验证的字体配置'}`});
 }
 if(choices.bodyWeight==='light'&&choices.cjk!=='source-han')problems.push({category:'bodyWeight',profile:'light',missingFonts:[],message:'轻字重正文须使用思源字体方案；更换中文字体时需明确选择常规字重。'});
 return problems;
}
export function assertJournalFonts(document,inventory){
 const problems=journalFontProblems(document,inventory);
 if(problems.length)throw Error('JOURNAL_FONTS_UNAVAILABLE: '+problems.map(p=>p.message).join('；')+'。请安装对应字体或在期刊模板中明确更换；系统不会自动替换。');
}
