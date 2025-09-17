#!/usr/bin/env node

const sqlite3 = require('sqlite3').verbose();
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { existsSync, statSync } = require('node:fs');
const { z } = require('zod');
const path = require('path');

class SQLiteHandler {
    constructor(dbPath) {
        this.dbPath = dbPath;
        
        // Open the database without logging
        this.db = new sqlite3.Database(dbPath, (err) => {
            if (err) {
                console.error(`Error opening database: ${err.message}`);
            }
        });
    }

    async setDatabasePath(newPath) {
        return new Promise((resolve, reject) => {
            this.db.close((closeErr) => {
                if (closeErr) {
                    return reject(closeErr);
                }

                this.dbPath = newPath;
                this.db = new sqlite3.Database(newPath, (openErr) => {
                    if (openErr) {
                        reject(openErr);
                    } else {
                        resolve();
                    }
                });
            });
        });
    }

    async executeQuery(sql, values = []) {
        return new Promise((resolve, reject) => {
            this.db.all(sql, values, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    async executeRun(sql, values = []) {
        return new Promise((resolve, reject) => {
            this.db.run(sql, values, function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve({
                        lastID: this.lastID,
                        changes: this.changes
                    });
                }
            });
        });
    }

    async listTables() {
        return this.executeQuery(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        );
    }

    async getTableSchema(tableName) {
        return this.executeQuery(`PRAGMA table_info(${tableName})`);
    }
}

async function main() {
    const args = process.argv.slice(2);
    let allowRuntimeDbPath = false;
    let dbPath = 'mydatabase.db';

    for (const arg of args) {
        if (arg === '--allow-runtime-db-path') {
            allowRuntimeDbPath = true;
        } else if (!arg.startsWith('--') && dbPath === 'mydatabase.db') {
            dbPath = arg;
        }
    }

    // Resolve to absolute path if relative
    let currentDbPath = path.isAbsolute(dbPath) ? dbPath : path.resolve(process.cwd(), dbPath);
    const handler = new SQLiteHandler(currentDbPath);
    const server = new McpServer({
        name: "mcp-sqlite-server",
        version: "1.1.0"
    });

    async function getDbInfo(dbPath) {
        const dbExists = existsSync(dbPath);
        let fileSize = 0;
        let fileStats = null;

        if (dbExists) {
            fileStats = statSync(dbPath);
            fileSize = fileStats.size;
        }

        const tableCountResult = await handler.executeQuery(
            "SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        );

        return {
            dbPath: dbPath,
            exists: dbExists,
            size: fileSize,
            lastModified: dbExists ? fileStats.mtime.toString() : null,
            tableCount: tableCountResult[0].count
        };
    }

    // Add a database info tool for debugging
    server.tool(
        "db_info",
        "Get information about the SQLite database including path, existence, size, and table count",
        {},
        async () => {
            try {
                const info = await getDbInfo(currentDbPath);
                return {
                    content: [{
                        type: "text",
                        text: JSON.stringify(info, null, 2)
                    }]
                };
            } catch (error) {
                return {
                    content: [{
                        type: "text",
                        text: `Error getting database info: ${error.message}`
                    }],
                    isError: true
                };
            }
        }
    );

    if (allowRuntimeDbPath) {
        server.tool(
            "set_database_path",
            "Change the SQLite database path to an existing database file",
            { dbPath: z.string() },
            async ({ dbPath }) => {
                try {
                    const newAbsoluteDbPath = path.isAbsolute(dbPath)
                        ? dbPath
                        : path.resolve(process.cwd(), dbPath);

                    if (!existsSync(newAbsoluteDbPath)) {
                        return {
                            content: [{
                                type: "text",
                                text: `Database file does not exist at path: ${newAbsoluteDbPath}`
                            }],
                            isError: true
                        };
                    }

                    await handler.setDatabasePath(newAbsoluteDbPath);
                    currentDbPath = newAbsoluteDbPath;
                    const info = await getDbInfo(currentDbPath);
                    return {
                        content: [{
                            type: "text",
                            text: JSON.stringify(info, null, 2)
                        }]
                    };
                } catch (error) {
                    return {
                        content: [{
                            type: "text",
                            text: `Error setting database path: ${error.message}`
                        }],
                        isError: true
                    };
                }
            }
        );

        server.tool(
            "create_database",
            "Create a new SQLite database and switch to it",
            { dbPath: z.string() },
            async ({ dbPath }) => {
                try {
                    const newAbsoluteDbPath = path.isAbsolute(dbPath)
                        ? dbPath
                        : path.resolve(process.cwd(), dbPath);

                    if (existsSync(newAbsoluteDbPath)) {
                        return {
                            content: [{
                                type: "text",
                                text: `Database already exists at path: ${newAbsoluteDbPath}`
                            }],
                            isError: true
                        };
                    }

                    await handler.setDatabasePath(newAbsoluteDbPath);
                    currentDbPath = newAbsoluteDbPath;
                    const info = await getDbInfo(currentDbPath);
                    return {
                        content: [{
                            type: "text",
                            text: JSON.stringify(info, null, 2)
                        }]
                    };
                } catch (error) {
                    return {
                        content: [{
                            type: "text",
                            text: `Error creating database: ${error.message}`
                        }],
                        isError: true
                    };
                }
            }
        );
    }

    // Register SQLite query tool
    server.tool(
        "query",
        "Execute a raw SQL query against the database with optional parameter values",
        { 
            sql: z.string(),
            values: z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional()
        },
        async ({ sql, values }) => {
            try {
                const results = await handler.executeQuery(sql, values);
                return {
                    content: [{ 
                        type: "text", 
                        text: JSON.stringify(results, null, 2) 
                    }]
                };
            } catch (error) {
                return {
                    content: [{ 
                        type: "text", 
                        text: `Error: ${error.message}` 
                    }],
                    isError: true
                };
            }
        }
    );

    // List Tables
    server.tool(
        "list_tables",
        "List all user tables in the SQLite database (excludes system tables)",
        {},
        async () => {
            try {
                const tables = await handler.listTables();
                
                if (tables.length === 0) {
                    return {
                        content: [{ 
                            type: "text", 
                            text: JSON.stringify({
                                message: "No tables found in database",
                                dbPath: currentDbPath,
                                exists: existsSync(currentDbPath),
                                size: existsSync(currentDbPath) ? statSync(currentDbPath).size : 0
                            }, null, 2)
                        }]
                    };
                }
                
                return {
                    content: [{ 
                        type: "text", 
                        text: JSON.stringify(tables, null, 2) 
                    }]
                };
            } catch (error) {
                return {
                    content: [{ 
                        type: "text", 
                        text: `Error listing tables: ${error.message}` 
                    }],
                    isError: true
                };
            }
        }
    );

    // Get Table Schema
    server.tool(
        "get_table_schema",
        "Get the schema information for a specific table including column details",
        { 
            tableName: z.string() 
        },
        async ({ tableName }) => {
            try {
                const schema = await handler.getTableSchema(tableName);
                return {
                    content: [{ 
                        type: "text", 
                        text: JSON.stringify(schema, null, 2) 
                    }]
                };
            } catch (error) {
                return {
                    content: [{ 
                        type: "text", 
                        text: `Error getting schema: ${error.message}` 
                    }],
                    isError: true
                };
            }
        }
    );

    // Create Record
    server.tool(
        "create_record",
        "Insert a new record into a table with specified data",
        { 
            table: z.string(),
            data: z.record(z.any())
        },
        async ({ table, data }) => {
            try {
                const columns = Object.keys(data);
                const placeholders = columns.map(() => '?').join(', ');
                const values = Object.values(data);
                
                const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`;
                const result = await handler.executeRun(sql, values);
                
                return {
                    content: [{ 
                        type: "text", 
                        text: JSON.stringify({
                            message: "Record created successfully",
                            insertedId: result.lastID
                        }, null, 2) 
                    }]
                };
            } catch (error) {
                return {
                    content: [{ 
                        type: "text", 
                        text: `Error creating record: ${error.message}` 
                    }],
                    isError: true
                };
            }
        }
    );

    // Read Records
    server.tool(
        "read_records",
        "Read records from a table with optional conditions, limit, and offset",
        { 
            table: z.string(),
            conditions: z.record(z.any()).optional(),
            limit: z.number().optional(),
            offset: z.number().optional()
        },
        async ({ table, conditions, limit, offset }) => {
            try {
                let sql = `SELECT * FROM ${table}`;
                const values = [];
                
                // Add WHERE clause if conditions provided
                if (conditions && Object.keys(conditions).length > 0) {
                    const whereConditions = Object.entries(conditions).map(([column, value]) => {
                        values.push(value);
                        return `${column} = ?`;
                    }).join(' AND ');
                    
                    sql += ` WHERE ${whereConditions}`;
                }
                
                // Add LIMIT and OFFSET
                if (limit !== undefined) {
                    sql += ` LIMIT ${limit}`;
                    if (offset !== undefined) {
                        sql += ` OFFSET ${offset}`;
                    }
                }
                
                const results = await handler.executeQuery(sql, values);
                
                return {
                    content: [{ 
                        type: "text", 
                        text: JSON.stringify(results, null, 2) 
                    }]
                };
            } catch (error) {
                return {
                    content: [{ 
                        type: "text", 
                        text: `Error reading records: ${error.message}` 
                    }],
                    isError: true
                };
            }
        }
    );

    // Update Records
    server.tool(
        "update_records",
        "Update records in a table based on specified conditions",
        { 
            table: z.string(),
            data: z.record(z.any()),
            conditions: z.record(z.any())
        },
        async ({ table, data, conditions }) => {
            try {
                // Build SET clause
                const setClause = Object.keys(data).map(key => `${key} = ?`).join(', ');
                const setValues = Object.values(data);
                
                // Build WHERE clause
                const whereClause = Object.keys(conditions).map(key => `${key} = ?`).join(' AND ');
                const whereValues = Object.values(conditions);
                
                const sql = `UPDATE ${table} SET ${setClause} WHERE ${whereClause}`;
                const result = await handler.executeRun(sql, [...setValues, ...whereValues]);
                
                return {
                    content: [{ 
                        type: "text", 
                        text: JSON.stringify({
                            message: "Records updated successfully",
                            rowsAffected: result.changes
                        }, null, 2) 
                    }]
                };
            } catch (error) {
                return {
                    content: [{ 
                        type: "text", 
                        text: `Error updating records: ${error.message}` 
                    }],
                    isError: true
                };
            }
        }
    );

    // Delete Records
    server.tool(
        "delete_records",
        "Delete records from a table based on specified conditions",
        { 
            table: z.string(),
            conditions: z.record(z.any())
        },
        async ({ table, conditions }) => {
            try {
                // Build WHERE clause
                const whereClause = Object.keys(conditions).map(key => `${key} = ?`).join(' AND ');
                const values = Object.values(conditions);
                
                const sql = `DELETE FROM ${table} WHERE ${whereClause}`;
                const result = await handler.executeRun(sql, values);
                
                return {
                    content: [{ 
                        type: "text", 
                        text: JSON.stringify({
                            message: "Records deleted successfully",
                            rowsAffected: result.changes
                        }, null, 2) 
                    }]
                };
            } catch (error) {
                return {
                    content: [{ 
                        type: "text", 
                        text: `Error deleting records: ${error.message}` 
                    }],
                    isError: true
                };
            }
        }
    );

    const transport = new StdioServerTransport();
    await server.connect(transport);
}

main();
