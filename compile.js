const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

const ROOT_DIR = __dirname;
const OUTPUT_ZIP = path.join(ROOT_DIR, 'build.zip');

const IGNORED_FOLDERS = ['.git', 'node_modules', '.gemini'];
const IGNORED_FILES = [
    'build.zip', 
    'compile.js', 
    'AGENTREADME', 
    '.gitattributes', 
    '.gitignore', 
    'agents_todo.md',
    'agent_todo.md'
];

// Helpers to check if a file requires comment stripping
const requiresStripping = (ext) => {
    return ['.js', '.css', '.html', '.json'].includes(ext);
};

function walkDir(dir, callback) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        const relPath = path.relative(ROOT_DIR, fullPath);
        
        // Skip ignored directories
        if (fs.statSync(fullPath).isDirectory()) {
            if (!IGNORED_FOLDERS.includes(file)) {
                walkDir(fullPath, callback);
            }
        } else {
            // Skip ignored files
            if (!IGNORED_FILES.includes(file)) {
                callback(fullPath, relPath);
            }
        }
    }
}

async function compile() {
    console.log('Derleme başlatılıyor...');
    
    // Create zip
    const output = fs.createWriteStream(OUTPUT_ZIP);
    const archive = archiver('zip', {
        zlib: { level: 9 } // Sets the compression level.
    });

    output.on('close', function() {
        console.log(`Derleme tamamlandı. ${OUTPUT_ZIP} oluşturuldu (Toplam: ${archive.pointer()} bayt)`);
    });

    archive.on('warning', function(err) {
        if (err.code === 'ENOENT') {
            console.warn(err);
        } else {
            throw err;
        }
    });

    archive.on('error', function(err) {
        throw err;
    });

    archive.pipe(output);

    walkDir(ROOT_DIR, (fullPath, relPath) => {
        const ext = path.extname(fullPath).toLowerCase();
        
        if (requiresStripping(ext) && !relPath.endsWith('package.json') && !relPath.endsWith('package-lock.json')) {
            try {
                const content = fs.readFileSync(fullPath, 'utf8');
                let stripped = content;
                
                const processReplacements = (regex) => {
                    stripped = stripped.replace(regex, (match, p1, offset) => {
                        // calculate lines before
                        const linesBefore = content.substring(0, offset).split('\n');
                        const line = linesBefore.length;
                        const char = linesBefore[linesBefore.length - 1].length + 1;
                        
                        // use p1 for captured group (inside comment), fallback to match if full replace
                        let cmtText = (typeof p1 === 'string' ? p1 : match).trim();
                        // formatting output
                        console.log(`Yorumlar silindi: '${cmtText}' | Dosya: ${path.basename(relPath)} | Satır: ${line} Karakter: ${char}`);
                        
                        return '';
                    });
                };

                if (ext === '.html') {
                    // removing HTML comments
                    processReplacements(/<!--([\s\S]*?)-->/g);
                } else if (ext === '.css') {
                    // removing block comments for CSS
                    processReplacements(/\/\*([\s\S]*?)\*\//g);
                } else {
                    // For JS, JSON
                    // Safely remove block and line comments while ignoring anything inside strings (single, double, or template literals)
                    const jsRegex = /\/\*([\s\S]*?)\*\/|\/\/([^\r\n]*)|("(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`)/g;
                    stripped = stripped.replace(jsRegex, (match, blockCmt, lineCmt, stringLiteral, offset) => {
                        if (stringLiteral) return stringLiteral; // Keep string literals intact
                        
                        const linesBefore = content.substring(0, offset).split('\n');
                        const line = linesBefore.length;
                        const char = linesBefore[linesBefore.length - 1].length + 1;
                        const cmtText = (blockCmt !== undefined ? blockCmt : lineCmt).trim();
                        
                        console.log(`Yorumlar silindi: '${cmtText}' | Dosya: ${path.basename(relPath)} | Satır: ${line} Karakter: ${char}`);
                        return '';
                    });
                }

                archive.append(stripped, { name: relPath });
            } catch (err) {
                console.error(`Hata işleniyor ${relPath}:`, err);
                archive.file(fullPath, { name: relPath });
            }
        } else {
            // Add file as is
            archive.file(fullPath, { name: relPath });
            console.log(`Olduğu gibi eklendi: ${relPath}`);
        }
    });

    await archive.finalize();
}

compile().catch(console.error);
