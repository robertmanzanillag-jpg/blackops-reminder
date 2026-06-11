import * as fs from 'fs';
import * as path from 'path';
import { db } from './db';
import { sql } from 'drizzle-orm';

const BACKUP_DIR = '.backups';
const PROJECT_ROOT = process.cwd();

// Allowed directories for file operations (security)
const ALLOWED_DIRS = ['client/src', 'server', 'shared'];
const ALLOWED_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.css', '.json', '.sql'];

interface FileChange {
  filePath: string;
  oldContent: string | null;
  newContent: string;
  timestamp: Date;
  description: string;
}

// In-memory change history (could be persisted to DB later)
const changeHistory: FileChange[] = [];

function isPathAllowed(filePath: string): boolean {
  const normalizedPath = path.normalize(filePath);
  
  // Prevent directory traversal
  if (normalizedPath.includes('..')) return false;
  
  // Check if path starts with allowed directory
  const isInAllowedDir = ALLOWED_DIRS.some(dir => normalizedPath.startsWith(dir));
  if (!isInAllowedDir) return false;
  
  // Check extension
  const ext = path.extname(normalizedPath);
  if (!ALLOWED_EXTENSIONS.includes(ext)) return false;
  
  return true;
}

function ensureBackupDir(): void {
  const backupPath = path.join(PROJECT_ROOT, BACKUP_DIR);
  if (!fs.existsSync(backupPath)) {
    fs.mkdirSync(backupPath, { recursive: true });
  }
}

function createBackup(filePath: string): string | null {
  const fullPath = path.join(PROJECT_ROOT, filePath);
  
  if (!fs.existsSync(fullPath)) {
    return null;
  }
  
  ensureBackupDir();
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupName = `${filePath.replace(/\//g, '_')}_${timestamp}`;
  const backupPath = path.join(PROJECT_ROOT, BACKUP_DIR, backupName);
  
  const content = fs.readFileSync(fullPath, 'utf-8');
  fs.writeFileSync(backupPath, content);
  
  return backupPath;
}

export async function readFile(filePath: string): Promise<{ success: boolean; content?: string; error?: string }> {
  if (!isPathAllowed(filePath)) {
    return { success: false, error: `Acceso denegado: ${filePath}` };
  }
  
  const fullPath = path.join(PROJECT_ROOT, filePath);
  
  try {
    if (!fs.existsSync(fullPath)) {
      return { success: false, error: `Archivo no encontrado: ${filePath}` };
    }
    
    const content = fs.readFileSync(fullPath, 'utf-8');
    return { success: true, content };
  } catch (error) {
    return { success: false, error: `Error leyendo archivo: ${error}` };
  }
}

export async function writeFile(
  filePath: string, 
  content: string,
  description: string = 'Cambio de archivo'
): Promise<{ success: boolean; backupPath?: string; error?: string }> {
  if (!isPathAllowed(filePath)) {
    return { success: false, error: `Acceso denegado: ${filePath}` };
  }
  
  const fullPath = path.join(PROJECT_ROOT, filePath);
  
  try {
    // Create backup if file exists
    let oldContent: string | null = null;
    let backupPath: string | null = null;
    
    if (fs.existsSync(fullPath)) {
      oldContent = fs.readFileSync(fullPath, 'utf-8');
      backupPath = createBackup(filePath);
    }
    
    // Ensure directory exists
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    // Write new content
    fs.writeFileSync(fullPath, content);
    
    // Record change in history
    changeHistory.push({
      filePath,
      oldContent,
      newContent: content,
      timestamp: new Date(),
      description
    });
    
    // Keep only last 50 changes
    if (changeHistory.length > 50) {
      changeHistory.shift();
    }
    
    return { success: true, backupPath: backupPath || undefined };
  } catch (error) {
    return { success: false, error: `Error escribiendo archivo: ${error}` };
  }
}

export async function listFiles(directory: string): Promise<{ success: boolean; files?: string[]; error?: string }> {
  // Normalize and check for traversal
  const normalizedDir = path.normalize(directory);
  if (normalizedDir.includes('..')) {
    return { success: false, error: `Acceso denegado: path traversal detectado` };
  }
  
  if (!ALLOWED_DIRS.some(dir => normalizedDir.startsWith(dir))) {
    return { success: false, error: `Acceso denegado: ${directory}` };
  }
  
  const fullPath = path.join(PROJECT_ROOT, normalizedDir);
  
  try {
    if (!fs.existsSync(fullPath)) {
      return { success: false, error: `Directorio no encontrado: ${directory}` };
    }
    
    const files: string[] = [];
    
    const walkDir = (dir: string, prefix: string = ''): void => {
      const items = fs.readdirSync(dir);
      for (const item of items) {
        const itemPath = path.join(dir, item);
        const relativePath = path.join(prefix, item);
        const stat = fs.statSync(itemPath);
        
        if (stat.isDirectory()) {
          walkDir(itemPath, relativePath);
        } else if (ALLOWED_EXTENSIONS.includes(path.extname(item))) {
          files.push(relativePath);
        }
      }
    };
    
    walkDir(fullPath, directory);
    return { success: true, files };
  } catch (error) {
    return { success: false, error: `Error listando archivos: ${error}` };
  }
}

export async function getChangeHistory(): Promise<FileChange[]> {
  return changeHistory.slice(-20); // Return last 20 changes
}

export async function undoLastChange(): Promise<{ success: boolean; filePath?: string; error?: string }> {
  if (changeHistory.length === 0) {
    return { success: false, error: 'No hay cambios para deshacer' };
  }
  
  const lastChange = changeHistory.pop()!;
  
  if (lastChange.oldContent === null) {
    // File was created, delete it
    const fullPath = path.join(PROJECT_ROOT, lastChange.filePath);
    try {
      fs.unlinkSync(fullPath);
      return { success: true, filePath: lastChange.filePath };
    } catch (error) {
      return { success: false, error: `Error eliminando archivo: ${error}` };
    }
  } else {
    // Restore old content
    const fullPath = path.join(PROJECT_ROOT, lastChange.filePath);
    try {
      fs.writeFileSync(fullPath, lastChange.oldContent);
      return { success: true, filePath: lastChange.filePath };
    } catch (error) {
      return { success: false, error: `Error restaurando archivo: ${error}` };
    }
  }
}

// Database schema operations
export async function getTableSchema(): Promise<{ success: boolean; tables?: any[]; error?: string }> {
  try {
    const result = await db.execute(sql`
      SELECT table_name, column_name, data_type, is_nullable
      FROM information_schema.columns 
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position
    `);
    
    return { success: true, tables: result.rows as any[] };
  } catch (error) {
    return { success: false, error: `Error obteniendo esquema: ${error}` };
  }
}

export async function executeQuery(query: string): Promise<{ success: boolean; result?: any; error?: string }> {
  // Only allow SELECT queries for safety
  const trimmedQuery = query.trim().toUpperCase();
  if (!trimmedQuery.startsWith('SELECT')) {
    return { success: false, error: 'Solo se permiten consultas SELECT por seguridad' };
  }
  
  try {
    const result = await db.execute(sql.raw(query));
    return { success: true, result: result.rows };
  } catch (error) {
    return { success: false, error: `Error ejecutando consulta: ${error}` };
  }
}

// Get project structure for context
export async function getProjectStructure(): Promise<string> {
  const structure: string[] = [];
  
  for (const dir of ALLOWED_DIRS) {
    const result = await listFiles(dir);
    if (result.success && result.files) {
      structure.push(`\n## ${dir}/`);
      result.files.forEach(f => structure.push(`  - ${f}`));
    }
  }
  
  return structure.join('\n');
}

// Database modification operations (for code generation)
interface ColumnDefinition {
  name: string;
  type: 'text' | 'integer' | 'boolean' | 'timestamp' | 'real' | 'jsonb';
  nullable?: boolean;
  defaultValue?: string;
}

interface TableDefinition {
  name: string;
  columns: ColumnDefinition[];
}

export async function addColumnToTable(
  tableName: string, 
  column: ColumnDefinition
): Promise<{ success: boolean; error?: string }> {
  // Validate table name
  const validTables = await db.execute(sql`
    SELECT table_name FROM information_schema.tables 
    WHERE table_schema = 'public'
  `);
  
  const tableExists = (validTables.rows as any[]).some(
    (t: any) => t.table_name === tableName
  );
  
  if (!tableExists) {
    return { success: false, error: `Tabla '${tableName}' no existe` };
  }
  
  // Map type to PostgreSQL type
  const pgTypeMap: Record<string, string> = {
    text: 'TEXT',
    integer: 'INTEGER',
    boolean: 'BOOLEAN',
    timestamp: 'TIMESTAMP',
    real: 'REAL',
    jsonb: 'JSONB'
  };
  
  const pgType = pgTypeMap[column.type];
  if (!pgType) {
    return { success: false, error: `Tipo '${column.type}' no soportado` };
  }
  
  try {
    let query = `ALTER TABLE "${tableName}" ADD COLUMN "${column.name}" ${pgType}`;
    if (!column.nullable) {
      query += ' NOT NULL';
    }
    if (column.defaultValue) {
      query += ` DEFAULT ${column.defaultValue}`;
    }
    
    await db.execute(sql.raw(query));
    return { success: true };
  } catch (error) {
    return { success: false, error: `Error agregando columna: ${error}` };
  }
}

export async function createTable(
  definition: TableDefinition
): Promise<{ success: boolean; error?: string }> {
  // Validate table name (alphanumeric and underscore only)
  if (!/^[a-z_][a-z0-9_]*$/.test(definition.name)) {
    return { success: false, error: 'Nombre de tabla inválido' };
  }
  
  const pgTypeMap: Record<string, string> = {
    text: 'TEXT',
    integer: 'INTEGER',
    boolean: 'BOOLEAN',
    timestamp: 'TIMESTAMP',
    real: 'REAL',
    jsonb: 'JSONB'
  };
  
  try {
    const columnDefs = definition.columns.map(col => {
      const pgType = pgTypeMap[col.type] || 'TEXT';
      let def = `"${col.name}" ${pgType}`;
      if (!col.nullable) def += ' NOT NULL';
      if (col.defaultValue) def += ` DEFAULT ${col.defaultValue}`;
      return def;
    });
    
    // Always add id and timestamps
    const query = `
      CREATE TABLE IF NOT EXISTS "${definition.name}" (
        "id" SERIAL PRIMARY KEY,
        ${columnDefs.join(',\n        ')},
        "created_at" TIMESTAMP DEFAULT NOW(),
        "updated_at" TIMESTAMP DEFAULT NOW()
      )
    `;
    
    await db.execute(sql.raw(query));
    return { success: true };
  } catch (error) {
    return { success: false, error: `Error creando tabla: ${error}` };
  }
}

export async function getTableInfo(tableName: string): Promise<{ 
  success: boolean; 
  columns?: any[];
  error?: string 
}> {
  try {
    const result = await db.execute(sql`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = ${tableName}
      ORDER BY ordinal_position
    `);
    
    return { success: true, columns: result.rows as any[] };
  } catch (error) {
    return { success: false, error: `Error obteniendo info de tabla: ${error}` };
  }
}
