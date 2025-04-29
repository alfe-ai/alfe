const fs = require('fs');
const path = require('path');
const ignore = require('ignore');

/**
 * Get ignore patterns from .gitignore files and add '.git' directory to ignores.
 * @param {string} dir - Directory to start looking for .gitignore.
 * @returns {object} - An ignore instance with the patterns.
 */
function getIgnorePatterns(dir) {
    const ig = ignore();

    // Always ignore the '.git' directory
    ig.add('.git/');

    let currentDir = dir;

    while (currentDir !== path.parse(currentDir).root) {
        const gitignorePath = path.join(currentDir, '.gitignore');
        if (fs.existsSync(gitignorePath)) {
            const gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
            ig.add(gitignoreContent);
        }
        currentDir = path.dirname(currentDir);
    }

    return ig;
}

/**
 * Normalize paths to use forward slashes.
 * @param {string} p - Path to normalize.
 * @returns {string} - Normalized path with forward slashes.
 */
function normalizePath(p) {
    return p.split(path.sep).join('/');
}

/**
 * Analyze directory structure excluding ignored patterns.
 * Errors (e.g., broken symlinks, deleted files) are caught and skipped
 * to prevent crashes such as the ENOENT on SingletonCookie.
 *
 * @param {string} dir - Directory to analyze.
 * @param {string} baseDir - Base directory for relative paths.
 * @param {object} ig - ignore instance with patterns.
 * @returns {object} - Tree structure representing the directory.
 */
function analyzeDirectory(dir, baseDir, ig) {
    const result = {
        name: path.basename(dir),
        path: normalizePath(path.relative(baseDir, dir)),
        type: 'directory',
        children: []
    };

    let items;
    try {
        items = fs.readdirSync(dir);
    } catch (err) {
        console.warn(`[directory_analyzer] Skipping unreadable directory: ${dir} -> ${err.message}`);
        return result;
    }

    for (const item of items) {
        const fullPath = path.join(dir, item);
        const relativePath = normalizePath(path.relative(baseDir, fullPath));

        if (ig.ignores(relativePath)) {
            continue;
        }

        let stats;
        try {
            // lstatSync so that broken symlinks don’t throw; they appear as type "symlink"
            stats = fs.lstatSync(fullPath);
        } catch (err) {
            console.warn(`[directory_analyzer] Skipping path (stat error): ${fullPath} -> ${err.message}`);
            continue; // Skip this entry and keep processing others
        }

        if (stats.isDirectory()) {
            const dirAnalysis = analyzeDirectory(fullPath, baseDir, ig);
            result.children.push(dirAnalysis);
        } else if (stats.isFile()) {
            let lineCount = 0;
            try {
                const fileContent = fs.readFileSync(fullPath, 'utf8');
                lineCount = fileContent.split('\n').length;
            } catch (err) {
                console.warn(`[directory_analyzer] Unable to read file: ${fullPath} -> ${err.message}`);
            }

            result.children.push({
                name: item,
                path: relativePath,
                lines: lineCount,
                type: 'file'
            });
        } else {
            // Non‑regular file (socket, symlink, etc.) – skip
            continue;
        }
    }

    return result;
}

/**
 * Formats the directory tree into a plain text tree-ish format.
 * Directories are listed before files at each level.
 * @param {object} node - The tree node to format.
 * @returns {string} - Formatted string representation.
 */
function formatTree(node) {
    let output = '';

    if (node.type === 'directory') {
        output += (node.path ? node.path : node.name) + '/\n';

        // Separate directories and files
        const dirs = node.children.filter(child => child.type === 'directory');
        const files = node.children.filter(child => child.type === 'file');

        // Optionally sort the dirs and files alphabetically
        dirs.sort((a, b) => a.name.localeCompare(b.name));
        files.sort((a, b) => a.name.localeCompare(b.name));

        // Process directories first
        for (const child of dirs) {
            output += formatTree(child);
        }

        // Then process files
        for (const child of files) {
            output += formatTree(child);
        }
    } else if (node.type === 'file') {
        output += node.path + ' (' + node.lines + ')\n';
    }

    return output;
}

// If executed from the command line
if (require.main === module) {
    const dir = process.argv[2];
    const isPlainText = process.argv.includes('--plain-text');

    if (!dir) {
        console.error('Usage: node directory_analyzer.js path/to/project/dir [--plain-text]');
        process.exit(1);
    }
    const fullDir = path.resolve(dir);
    const ig = getIgnorePatterns(fullDir);
    const tree = analyzeDirectory(fullDir, fullDir, ig);

    if (isPlainText) {
        const output = formatTree(tree);
        console.log(output);
    } else {
        console.log(JSON.stringify(tree, null, 2));
    }
}

// Exported function for use in other modules
module.exports = {
    analyzeProject: function (projectDir, options = {}) {
        const fullDir = path.resolve(projectDir);
        const ig = getIgnorePatterns(fullDir);
        const tree = analyzeDirectory(fullDir, fullDir, ig);

        if (options.plainText) {
            return formatTree(tree);
        } else {
            return tree;
        }
    },
};
