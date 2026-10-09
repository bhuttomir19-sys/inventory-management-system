const MAX_LOGO_BYTES = 512 * 1024;
export function validateBranding(settings) {
 if(typeof settings.company!=='string'||!settings.company.trim()||settings.company.trim().length>120)throw Error('Company name is required (maximum 120 characters)');
 if(settings.appName!==undefined&&(typeof settings.appName!=='string'||!settings.appName.trim()||settings.appName.trim().length>60))throw Error('Application name must contain 1–60 characters');
 if(settings.logo){
  if(typeof settings.logo!=='string'||settings.logo.length>Math.ceil(MAX_LOGO_BYTES*4/3)+50)throw Error('Logo must be no larger than 512 KB');
  const match=/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(settings.logo);
  if(!match)throw Error('Choose a PNG, JPEG, or WebP logo');
  const bytes=Buffer.from(match[2],'base64');
  const valid=match[1]==='png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):match[1]==='jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
  if(!valid||bytes.length>MAX_LOGO_BYTES)throw Error('Invalid logo image');
 }
 return {...settings,company:settings.company.trim(),...(settings.appName!==undefined?{appName:settings.appName.trim()}:{})};
}
export const publicBranding=settings=>({appName:settings.appName||settings.company||'Tradeflow',company:settings.company||'',logo:settings.logo||''});
