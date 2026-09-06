"""Build a local-only WebGL2 compatibility probe from a user-supplied shader ZIP."""
import argparse, hashlib, json, pathlib, re, subprocess, zipfile

parser = argparse.ArgumentParser()
parser.add_argument('pack', type=pathlib.Path)
parser.add_argument('--output', type=pathlib.Path, default=pathlib.Path('work/complementary'))
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)
z = zipfile.ZipFile(args.pack)
props = z.read('shaders/shaders.properties').decode()
profile = dict(x.split('=', 1) for x in re.search(r'profile.LOW\s*=([^\r\n]+)', props)[1].split())

def expand(name, chain=()):
    if name in chain: raise ValueError(f'Include cycle: {name}')
    text = z.read(name).decode().replace('\r', '')
    for key, value in profile.items():
        text = re.sub(r'(?m)^(\s*#define\s+' + re.escape(key) + r')\s+[^\n]+', lambda m: m[1]+' '+value, text)
        text = re.sub(r'(const float '+re.escape(key)+r'\s*=\s*)[^;]+', lambda m:m[1]+value, text)
    text = re.sub(r'^\s*#version[^\n]*', '', text, flags=re.M)
    return re.sub(r'#include\s+"([^"]+)"', lambda m: expand('shaders/'+m[1].lstrip('/') if m[1].startswith('/') else str(pathlib.PurePosixPath(name).parent/m[1]), (*chain,name)), text)

def convert(text, stage):
    text = re.sub(r'^\s*#extension[^\n]*', '', text, flags=re.M)
    replacements = {'texture2D':'texture','texture2DLod':'textureLod','texture2DGradARB':'textureGrad','texture2DLodARB':'textureLod','texture2DGrad':'textureGrad','texture3D':'texture','texture3DLod':'textureLod','attribute':'in','gl_Vertex':'sp_Vertex','gl_Color':'sp_Color','gl_Normal':'sp_Normal','gl_MultiTexCoord0':'sp_UV0','gl_MultiTexCoord1':'sp_UV1','gl_MultiTexCoord2':'sp_UV2','gl_ModelViewMatrix':'sp_ModelView','gl_ModelViewProjectionMatrix':'sp_MVP','gl_ProjectionMatrix':'sp_Projection','gl_NormalMatrix':'sp_NormalMatrix','gl_TextureMatrix':'sp_TextureMatrix'}
    for old,new in replacements.items(): text=re.sub(r'\b'+old+r'\b',new,text)
    text=text.replace('ftransform()', '(sp_MVP * sp_Vertex)')
    header='#version 450 core\nvec4 shadow2D(sampler2DShadow s, vec3 p) { return vec4(texture(s,p)); }\n'
    declarations={'sp_Vertex':'in vec4','sp_Color':'in vec4','sp_Normal':'in vec3','sp_UV0':'in vec4','sp_UV1':'in vec4','sp_UV2':'in vec4','sp_ModelView':'uniform mat4','sp_MVP':'uniform mat4','sp_Projection':'uniform mat4','sp_NormalMatrix':'uniform mat3','sp_TextureMatrix':'uniform mat4'}
    for name,kind in declarations.items():
        if re.search(r'\b'+name+r'\b',text): header+=f'{kind} {name}'+('[8]' if name=='sp_TextureMatrix' else '')+';\n'
    outputs=sorted(set(int(x) for x in re.findall(r'gl_FragData\[(\d+)\]',text)))
    for i in outputs:
        header+=f'layout(location={i}) out vec4 sp_Output{i};\n'
        text=text.replace(f'gl_FragData[{i}]',f'sp_Output{i}')
    return header+text

programs={}
for program in ['shadow','gbuffers_terrain']:
    programs[program]={}
    for stage in ['vsh','fsh']:
        source=expand(f'shaders/world0/{program}.{stage}')
        # Shader preprocessor context only. No optional Iris features are advertised.
        source='#define MC_VERSION 12602\n#define MC_GL_VERSION 300\n#define MC_GLSL_VERSION 300\n'+source
        result=subprocess.run(['clang','-E','-P','-CC','-x','c','-'],input=source,text=True,capture_output=True,check=True)
        desktop=convert(result.stdout,stage)
        desktop_path=args.output/f'{program}.{stage}.desktop'
        desktop_path.write_text(desktop)
        binary=args.output/f'{program}.{stage}.spv'
        shader_stage='vert' if stage=='vsh' else 'frag'
        subprocess.run(['glslangValidator','-G','--auto-map-bindings','--auto-map-locations','-S',shader_stage,str(desktop_path),'-o',str(binary)],check=True)
        converted=subprocess.run(['spirv-cross',str(binary),'--es','--version','300'],capture_output=True,text=True,check=True).stdout
        defaults=dict(re.findall(r'uniform (?:highp |mediump |lowp )?\w+ (\w+) = ([^;]+);',converted))
        programs[program].setdefault('defaults',{}).update(defaults)
        converted=re.sub(r'(uniform (?:highp |mediump |lowp )?\w+ \w+) = [^;]+;',r'\1;',converted)
        (args.output/f'{program}.{stage}').write_text(converted)
        programs[program][stage]=converted
manifest={'pack':args.pack.name,'sha256':hashlib.sha256(args.pack.read_bytes()).hexdigest(),'profile':profile,'programs':programs,'scope':'Original LOW terrain and shadow programs; synthetic geometry; no game integration or final composite.'}
(args.output/'pack.json').write_text(json.dumps(manifest))
(args.output/'three.module.js').write_bytes(pathlib.Path('node_modules/three/build/three.module.js').read_bytes())
for name in ['index.html','probe.js','scene.js']:
    (args.output/name).write_text((pathlib.Path(__file__).parent/name).read_text())
print(args.output)
