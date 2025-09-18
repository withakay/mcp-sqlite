# Changelog

All notable changes to the MCP SQLite Server will be documented in this file.

## [1.1.0] - 2025-06-03
### ✨ Added
- Optional `--allow-runtime-db-path` flag to enable changing the database path at runtime.
- New `set_database_path` and `create_database` tools for managing database paths when the flag is enabled.

## [1.0.7] - 2025-06-02
### 📦 Updated
- Added a "description" parameter to each tool definitions for better Agent selection

### 🐛 Fixed
- Resolved a know validation issue with VS Code that requires stricter JSON schema validation

## [1.0.0] - 2025-04-05
### ✨ Added
- Initial release of MCP SQLite Server
- Complete set of CRUD operations:
  - `create_record` - Insert data into tables
  - `read_records` - Query records with filtering, limit and offset
  - `update_records` - Modify existing records with conditions
  - `delete_records` - Remove records matching conditions
- Database exploration tools:
  - `list_tables` - List all tables in the database
  - `get_table_schema` - Get column information for tables
  - `db_info` - Get database file metadata
- Custom SQL query execution with the `query` tool
- Support for relative and absolute database paths
- Detailed error reporting for all operations
- Comprehensive JSON response formatting
- Full documentation in README.md 