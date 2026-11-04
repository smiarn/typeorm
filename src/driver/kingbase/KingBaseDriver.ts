import { ObjectLiteral } from "../../common/ObjectLiteral"
import { DataSource } from "../../data-source/DataSource"
import { ConnectionIsNotSetError } from "../../error/ConnectionIsNotSetError"
import { DriverPackageNotInstalledError } from "../../error/DriverPackageNotInstalledError"
import { ColumnMetadata } from "../../metadata/ColumnMetadata"
import { EntityMetadata } from "../../metadata/EntityMetadata"
import { PlatformTools } from "../../platform/PlatformTools"
import { QueryRunner } from "../../query-runner/QueryRunner"
import { RdbmsSchemaBuilder } from "../../schema-builder/RdbmsSchemaBuilder"
import { TableColumn } from "../../schema-builder/table/TableColumn"
// import { ApplyValueTransformers } from "../../util/ApplyValueTransformers"
import { DateUtils } from "../../util/DateUtils"
import { OrmUtils } from "../../util/OrmUtils"
import { Driver } from "../Driver"
import { ColumnType } from "../types/ColumnTypes"
import { CteCapabilities } from "../types/CteCapabilities"
import { DataTypeDefaults } from "../types/DataTypeDefaults"
import { MappedColumnTypes } from "../types/MappedColumnTypes"
import { ReplicationMode } from "../types/ReplicationMode"
import { VersionUtils } from "../../util/VersionUtils"
import { KingBaseConnectionCredentialsOptions } from "./KingBaseConnectionCredentialsOptions"
import { KingBaseConnectionOptions } from "./KingBaseConnectionOptions"
import { KingBaseQueryRunner } from "./KingBaseQueryRunner"
import { DriverUtils } from "../DriverUtils"
import { TypeORMError } from "../../error"
import { Table } from "../../schema-builder/table/Table"
import { View } from "../../schema-builder/view/View"
import { TableForeignKey } from "../../schema-builder/table/TableForeignKey"
import { InstanceChecker } from "../../util/InstanceChecker"
import { UpsertType } from "../types/UpsertType"
import { ApplyValueTransformers } from "../../util/ApplyValueTransformers"

export type ReturningType = "insert" | "update" | "delete"

/**
 * Organizes communication with PostgreSQL DBMS.
 */
export class KingBaseDriver implements Driver {
    // -------------------------------------------------------------------------
    // Public Properties
    // -------------------------------------------------------------------------

    /**
     * Connection used by driver.
     */
    connection: DataSource

    /**
     * Postgres underlying library.
     */
    postgres: any

    /**
     * Pool for master database.
     */
    master: any

    /**
     * Pool for slave databases.
     * Used in replication.
     */
    slaves: any[] = []

    /**
     * We store all created query runners because we need to release them.
     */
    connectedQueryRunners: QueryRunner[] = []

    // -------------------------------------------------------------------------
    // Public Implemented Properties
    // -------------------------------------------------------------------------

    /**
     * Connection options.
     */
    options: KingBaseConnectionOptions

    /**
     * Version of Postgres. Requires a SQL query to the DB, so it is not always set
     */
    version?: string

    /**
     * Database name used to perform all write queries.
     */
    database?: string

    /**
     * Schema name used to perform all write queries.
     */
    schema?: string

    /**
     * Schema that's used internally by Postgres for object resolution.
     *
     * Because we never set this we have to track it in separately from the `schema` so
     * we know when we have to specify the full schema or not.
     *
     * In most cases this will be `public`.
     */
    searchSchema?: string

    /**
     * Indicates if replication is enabled.
     */
    isReplicated: boolean = false

    /**
     * Indicates if tree tables are supported by this driver.
     */
    treeSupport = true

    /**
     * Represent transaction support by this driver
     */
    transactionSupport = "nested" as const

    /**
     * Gets list of supported column data types by a driver.
     *
     * @see https://www.tutorialspoint.com/postgresql/postgresql_data_types.htm
     * @see https://www.postgresql.org/docs/9.2/static/datatype.html
     */
    supportedDataTypes: ColumnType[] = [
        "int",
        "int2",
        "int4",
        "int8",
        "smallint",
        "integer",
        "bigint",
        "decimal",
        "numeric",
        "real",
        "float",
        "float4",
        "float8",
        "double precision",
        "money",
        "character varying",
        "varchar",
        "character",
        "char",
        "text",
        "citext",
        "hstore",
        "bytea",
        "bit",
        "varbit",
        "bit varying",
        "timetz",
        "timestamptz",
        "timestamp",
        "timestamp without time zone",
        "timestamp with time zone",
        "date",
        "time",
        "time without time zone",
        "time with time zone",
        "interval",
        "bool",
        "boolean",
        "enum",
        "point",
        "line",
        "lseg",
        "box",
        "path",
        "polygon",
        "circle",
        "cidr",
        "inet",
        "macaddr",
        "tsvector",
        "tsquery",
        "uuid",
        "xml",
        "json",
        "jsonb",
        "int4range",
        "int8range",
        "numrange",
        "tsrange",
        "tstzrange",
        "daterange",
        "geometry",
        "geography",
        "cube",
        "ltree",
    ]

    /**
     * Returns type of upsert supported by driver if any
     */
    supportedUpsertTypes: UpsertType[] = ["on-conflict-do-update"]

    /**
     * Gets list of spatial column data types.
     */
    spatialTypes: ColumnType[] = ["geometry", "geography"]

    /**
     * Gets list of column data types that support length by a driver.
     */
    withLengthColumnTypes: ColumnType[] = [
        "character varying",
        "varchar",
        "character",
        "char",
        "bit",
        "varbit",
        "bit varying",
    ]

    /**
     * Gets list of column data types that support precision by a driver.
     */
    withPrecisionColumnTypes: ColumnType[] = [
        "numeric",
        "decimal",
        "interval",
        "time without time zone",
        "time with time zone",
        "timestamp without time zone",
        "timestamp with time zone",
    ]

    /**
     * Gets list of column data types that support scale by a driver.
     */
    withScaleColumnTypes: ColumnType[] = ["numeric", "decimal"]

    /**
     * Orm has special columns and we need to know what database column types should be for those types.
     * Column types are driver dependant.
     */
    mappedDataTypes: MappedColumnTypes = {
        createDate: "timestamp",
        createDateDefault: "now()",
        updateDate: "timestamp",
        updateDateDefault: "now()",
        deleteDate: "timestamp",
        deleteDateNullable: true,
        version: "int4",
        treeLevel: "int4",
        migrationId: "int4",
        migrationName: "varchar",
        migrationTimestamp: "int8",
        cacheId: "int4",
        cacheIdentifier: "varchar",
        cacheTime: "int8",
        cacheDuration: "int4",
        cacheQuery: "text",
        cacheResult: "text",
        metadataType: "varchar",
        metadataDatabase: "varchar",
        metadataSchema: "varchar",
        metadataTable: "varchar",
        metadataName: "varchar",
        metadataValue: "text",
    }

    /**
     * Default values of length, precision and scale depends on column data type.
     * Used in the cases when length/precision/scale is not specified by user.
     */
    dataTypeDefaults: DataTypeDefaults = {
        character: { length: 1 },
        bit: { length: 1 },
        interval: { precision: 6 },
        "time without time zone": { precision: 6 },
        "time with time zone": { precision: 6 },
        "timestamp without time zone": { precision: 6 },
        "timestamp with time zone": { precision: 6 },
    }

    /**
     * Max length allowed by Postgres for aliases.
     * @see https://www.postgresql.org/docs/current/sql-syntax-lexical.html#SQL-SYNTAX-IDENTIFIERS
     */
    maxAliasLength = 63

    isGeneratedColumnsSupported: boolean = false

    cteCapabilities: CteCapabilities = {
        enabled: true,
        writable: true,
        requiresRecursiveHint: true,
        materializedHint: true,
    }

    private uuidColumnTypeSuported = false

    /**
     * Supported returning types
     */
    private readonly _isReturningSqlSupported: Record<ReturningType, boolean> =
        {
            delete: false,
            insert: false,
            update: false,
        }

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    constructor(connection?: DataSource) {
        if (!connection) {
            return
        }

        this.connection = connection
        this.options = connection.options as KingBaseConnectionOptions
        this.isReplicated = this.options.replication ? true : false
        if (this.options.useUTC) {
            process.env.PGTZ = "UTC"
        }
        // load postgres package
        this.loadDependencies()

        this.database = DriverUtils.buildDriverOptions(
            this.options.replication
                ? this.options.replication.master
                : this.options,
        ).database
        this.schema = DriverUtils.buildDriverOptions(this.options).schema

        // ObjectUtils.assign(this.options, DriverUtils.buildDriverOptions(connection.options)); // todo: do it better way
        // validate options to make sure everything is set
        // todo: revisit validation with replication in mind
        // if (!this.options.host)
        //     throw new DriverOptionNotSetError("host");
        // if (!this.options.username)
        //     throw new DriverOptionNotSetError("username");
        // if (!this.options.database)
        //     throw new DriverOptionNotSetError("database");
    }

    // -------------------------------------------------------------------------
    // Public Implemented Methods
    // -------------------------------------------------------------------------

    /**
     * Performs connection to the database.
     * Based on pooling options, it can either create connection immediately,
     * either create a pool and create connection when needed.
     */
    async connect(): Promise<void> {
        if (this.options.replication) {
            this.slaves = await Promise.all(
                this.options.replication.slaves.map((slave) => {
                    return this.createPool(this.options, slave)
                }),
            )
            this.master = await this.createPool(
                this.options,
                this.options.replication.master,
            )
        } else {
            this.master = await this.createPool(this.options, this.options)
        }

        if (!this.database || !this.searchSchema) {
            const queryRunner = await this.createQueryRunner("master")
            const result: {
                version: string
            }[] = await queryRunner.query(`SELECT VERSION() AS \`version\``)
            const dbVersion = result[0].version
            if (VersionUtils.isGreaterOrEqual(dbVersion, "8.0.0")) {
                this.cteCapabilities.enabled = true
            }
            if (!this.database) {
                this.database = await queryRunner.getCurrentDatabase()
            }

            if (!this.searchSchema) {
                this.searchSchema = await queryRunner.getCurrentSchema()
            }

            await queryRunner.release()
        }

        if (!this.schema) {
            this.schema = this.searchSchema
        }
    }

    /**
     * Makes any action after connection (e.g. create extensions in Postgres driver).
     */
    async afterConnect(): Promise<void> {
        const extensionsMetadata = await this.checkMetadataForExtensions()
        const [connection, release] = await this.obtainMasterConnection()

        const installExtensions =
            this.options.installExtensions === undefined ||
            this.options.installExtensions
        if (installExtensions && extensionsMetadata.hasExtensions) {
            await this.enableExtensions(extensionsMetadata, connection)
        }

        const results = (await this.executeQuery(
            connection,
            "SELECT version();",
        )) as {
            rows: {
                version: string
            }[]
        }
        const versionString = results.rows[0].version.replace(
            /^PostgreSQL ([\d\.]+) .*$/,
            "$1",
        )
        this.version = versionString
        this.isGeneratedColumnsSupported = VersionUtils.isGreaterOrEqual(
            versionString,
            "12.0",
        )

        await release()
    }

    protected async enableExtensions(extensionsMetadata: any, connection: any) {
        const { logger } = this.connection

        const {
            hasUuidColumns,
            hasCitextColumns,
            hasHstoreColumns,
            hasCubeColumns,
            hasGeometryColumns,
            hasLtreeColumns,
            hasExclusionConstraints,
        } = extensionsMetadata

        if (hasUuidColumns)
            try {
                await this.executeQuery(
                    connection,
                    `CREATE EXTENSION IF NOT EXISTS "${
                        this.options.uuidExtension || "uuid-ossp"
                    }"`,
                )
            } catch (_) {
                logger.log(
                    "warn",
                    `At least one of the entities has uuid column, but the '${
                        this.options.uuidExtension || "uuid-ossp"
                    }' extension cannot be installed automatically. Please install it manually using superuser rights, or select another uuid extension.`,
                )
            }
        if (hasCitextColumns)
            try {
                await this.executeQuery(
                    connection,
                    `CREATE EXTENSION IF NOT EXISTS "citext"`,
                )
            } catch (_) {
                logger.log(
                    "warn",
                    "At least one of the entities has citext column, but the 'citext' extension cannot be installed automatically. Please install it manually using superuser rights",
                )
            }
        if (hasHstoreColumns)
            try {
                await this.executeQuery(
                    connection,
                    `CREATE EXTENSION IF NOT EXISTS "hstore"`,
                )
            } catch (_) {
                logger.log(
                    "warn",
                    "At least one of the entities has hstore column, but the 'hstore' extension cannot be installed automatically. Please install it manually using superuser rights",
                )
            }
        if (hasGeometryColumns)
            try {
                await this.executeQuery(
                    connection,
                    `CREATE EXTENSION IF NOT EXISTS "postgis"`,
                )
            } catch (_) {
                logger.log(
                    "warn",
                    "At least one of the entities has a geometry column, but the 'postgis' extension cannot be installed automatically. Please install it manually using superuser rights",
                )
            }
        if (hasCubeColumns)
            try {
                await this.executeQuery(
                    connection,
                    `CREATE EXTENSION IF NOT EXISTS "cube"`,
                )
            } catch (_) {
                logger.log(
                    "warn",
                    "At least one of the entities has a cube column, but the 'cube' extension cannot be installed automatically. Please install it manually using superuser rights",
                )
            }
        if (hasLtreeColumns)
            try {
                await this.executeQuery(
                    connection,
                    `CREATE EXTENSION IF NOT EXISTS "ltree"`,
                )
            } catch (_) {
                logger.log(
                    "warn",
                    "At least one of the entities has a ltree column, but the 'ltree' extension cannot be installed automatically. Please install it manually using superuser rights",
                )
            }
        if (hasExclusionConstraints)
            try {
                // The btree_gist extension provides operator support in PostgreSQL exclusion constraints
                await this.executeQuery(
                    connection,
                    `CREATE EXTENSION IF NOT EXISTS "btree_gist"`,
                )
            } catch (_) {
                logger.log(
                    "warn",
                    "At least one of the entities has an exclusion constraint, but the 'btree_gist' extension cannot be installed automatically. Please install it manually using superuser rights",
                )
            }
    }

    protected async checkMetadataForExtensions() {
        const hasUuidColumns = this.connection.entityMetadatas.some(
            (metadata) => {
                return (
                    metadata.generatedColumns.filter(
                        (column) => column.generationStrategy === "uuid",
                    ).length > 0
                )
            },
        )
        const hasCitextColumns = this.connection.entityMetadatas.some(
            (metadata) => {
                return (
                    metadata.columns.filter(
                        (column) => column.type === "citext",
                    ).length > 0
                )
            },
        )
        const hasHstoreColumns = this.connection.entityMetadatas.some(
            (metadata) => {
                return (
                    metadata.columns.filter(
                        (column) => column.type === "hstore",
                    ).length > 0
                )
            },
        )
        const hasCubeColumns = this.connection.entityMetadatas.some(
            (metadata) => {
                return (
                    metadata.columns.filter((column) => column.type === "cube")
                        .length > 0
                )
            },
        )
        const hasGeometryColumns = this.connection.entityMetadatas.some(
            (metadata) => {
                return (
                    metadata.columns.filter(
                        (column) => this.spatialTypes.indexOf(column.type) >= 0,
                    ).length > 0
                )
            },
        )
        const hasLtreeColumns = this.connection.entityMetadatas.some(
            (metadata) => {
                return (
                    metadata.columns.filter((column) => column.type === "ltree")
                        .length > 0
                )
            },
        )
        const hasExclusionConstraints = this.connection.entityMetadatas.some(
            (metadata) => {
                return metadata.exclusions.length > 0
            },
        )

        return {
            hasUuidColumns,
            hasCitextColumns,
            hasHstoreColumns,
            hasCubeColumns,
            hasGeometryColumns,
            hasLtreeColumns,
            hasExclusionConstraints,
            hasExtensions:
                hasUuidColumns ||
                hasCitextColumns ||
                hasHstoreColumns ||
                hasGeometryColumns ||
                hasCubeColumns ||
                hasLtreeColumns ||
                hasExclusionConstraints,
        }
    }

    /**
     * Closes connection with database.
     */
    async disconnect(): Promise<void> {
        if (!this.master)
            return Promise.reject(new ConnectionIsNotSetError("kb"))

        await this.closePool(this.master)
        await Promise.all(this.slaves.map((slave) => this.closePool(slave)))
        this.master = undefined
        this.slaves = []
    }

    /**
     * Creates a schema builder used to build and sync a schema.
     */
    createSchemaBuilder() {
        return new RdbmsSchemaBuilder(this.connection)
    }

    /**
     * Creates a query runner used to execute database queries.
     */
    createQueryRunner(mode: ReplicationMode): QueryRunner {
        return new KingBaseQueryRunner(this, mode)
    }

    /**
     * Replaces parameters in the given sql with special escaping character
     * and an array of parameter names to be passed to a query.
     */
    escapeQueryWithParameters(
        sql: string,
        parameters: ObjectLiteral,
        nativeParameters: ObjectLiteral,
    ): [string, any[]] {
        const escapedParameters: any[] = Object.keys(nativeParameters).map(
            (key) => nativeParameters[key],
        )
        if (!parameters || !Object.keys(parameters).length)
            return [sql, escapedParameters]

        sql = sql.replace(
            /:(\.\.\.)?([A-Za-z0-9_.]+)/g,
            (full, isArray: string, key: string): string => {
                if (!parameters.hasOwnProperty(key)) {
                    return full
                }

                let value: any = parameters[key]

                if (isArray) {
                    return value
                        .map((v: any) => {
                            escapedParameters.push(v)
                            return this.createParameter(
                                key,
                                escapedParameters.length - 1,
                            )
                        })
                        .join(", ")
                }

                if (typeof value === "function") {
                    return value()
                }

                escapedParameters.push(value)
                return this.createParameter(key, escapedParameters.length - 1)
            },
        ) // todo: make replace only in value statements, otherwise problems
        return [sql, escapedParameters]
    }

    /**
     * Escapes a column name.
     */
    escape(columnName: string): string {
        return "`" + columnName + "`"
    }

    /**
     * Build full table name with schema name and table name.
     * E.g. myDB.mySchema.myTable
     */
    buildTableName(
        tableName: string,
        schema?: string,
        database?: string,
    ): string {
        let tablePath = [tableName]

        if (schema) {
            tablePath.unshift(schema)
        }

        if (database) {
            tablePath.unshift(database)
        }

        return tablePath.join(".")
    }

    /**
     * Parse a target table name or other types and return a normalized table definition.
     */
    parseTableName(
        target: EntityMetadata | Table | View | TableForeignKey | string,
    ): { database?: string; schema?: string; tableName: string } {
        const driverDatabase = this.database
        const driverSchema = undefined

        if (InstanceChecker.isTable(target) || InstanceChecker.isView(target)) {
            const parsed = this.parseTableName(target.name)

            return {
                database: target.database || parsed.database || driverDatabase,
                schema: target.schema || parsed.schema || driverSchema,
                tableName: parsed.tableName,
            }
        }

        if (InstanceChecker.isTableForeignKey(target)) {
            const parsed = this.parseTableName(target.referencedTableName)

            return {
                database:
                    target.referencedDatabase ||
                    parsed.database ||
                    driverDatabase,
                schema:
                    target.referencedSchema || parsed.schema || driverSchema,
                tableName: parsed.tableName,
            }
        }

        if (InstanceChecker.isEntityMetadata(target)) {
            // EntityMetadata tableName is never a path

            return {
                database: target.database || driverDatabase,
                schema: target.schema || driverSchema,
                tableName: target.tableName,
            }
        }

        const parts = target.split(".")

        return {
            database:
                (parts.length > 1 ? parts[0] : undefined) || driverDatabase,
            schema: driverSchema,
            tableName: parts.length > 1 ? parts[1] : parts[0],
        }
    }

    /**
     * Prepares given value to a value to be persisted, based on its column type and metadata.
     */
    preparePersistentValue(value: any, columnMetadata: ColumnMetadata): any {
        if (columnMetadata.transformer)
            value = ApplyValueTransformers.transformTo(
                columnMetadata.transformer,
                value,
            )

        if (value === null || value === undefined) return value

        if (columnMetadata.type === Boolean) {
            return value === true ? 1 : 0
        } else if (columnMetadata.type === "date") {
            return DateUtils.mixedDateToDateString(value)
        } else if (columnMetadata.type === "time") {
            return DateUtils.mixedDateToTimeString(value)
        } else if (columnMetadata.type === "json") {
            return JSON.stringify(value)
        } else if (
            columnMetadata.type === "timestamp" ||
            columnMetadata.type === "datetime" ||
            columnMetadata.type === Date
        ) {
            return DateUtils.mixedDateToDate(value)
        } else if (columnMetadata.type === "simple-array") {
            return DateUtils.simpleArrayToString(value)
        } else if (columnMetadata.type === "simple-json") {
            return DateUtils.simpleJsonToString(value)
        } else if (
            columnMetadata.type === "enum" ||
            columnMetadata.type === "simple-enum"
        ) {
            return "" + value
        } else if (columnMetadata.type === "set") {
            return DateUtils.simpleArrayToString(value)
        } else if (columnMetadata.type === Number) {
            // convert to number if number
            value = !isNaN(+value) ? parseInt(value) : value
        }

        return value
    }

    /**
     * Prepares given value to a value to be persisted, based on its column type or metadata.
     */
    prepareHydratedValue(value: any, columnMetadata: ColumnMetadata): any {
        if (value === null || value === undefined)
            return columnMetadata.transformer
                ? ApplyValueTransformers.transformFrom(
                      columnMetadata.transformer,
                      value,
                  )
                : value

        if (
            columnMetadata.type === Boolean ||
            columnMetadata.type === "bool" ||
            columnMetadata.type === "boolean"
        ) {
            value = value ? true : false
        } else if (
            columnMetadata.type === "datetime" ||
            columnMetadata.type === Date
        ) {
            value = DateUtils.normalizeHydratedDate(value)
        } else if (columnMetadata.type === "date") {
            value = DateUtils.mixedDateToDateString(value)
        } else if (columnMetadata.type === "json") {
            value = typeof value === "string" ? JSON.parse(value) : value
        } else if (columnMetadata.type === "time") {
            value = DateUtils.mixedTimeToString(value)
        } else if (columnMetadata.type === "simple-array") {
            value = DateUtils.stringToSimpleArray(value)
        } else if (columnMetadata.type === "simple-json") {
            value = DateUtils.stringToSimpleJson(value)
        } else if (
            (columnMetadata.type === "enum" ||
                columnMetadata.type === "simple-enum") &&
            columnMetadata.enum &&
            !isNaN(value) &&
            columnMetadata.enum.indexOf(parseInt(value)) >= 0
        ) {
            // convert to number if that exists in possible enum options
            value = parseInt(value)
        } else if (columnMetadata.type === "set") {
            value = DateUtils.stringToSimpleArray(value)
        } else if (columnMetadata.type === Number) {
            // convert to number if number
            value = !isNaN(+value) ? parseInt(value) : value
        }

        if (columnMetadata.transformer)
            value = ApplyValueTransformers.transformFrom(
                columnMetadata.transformer,
                value,
            )

        return value
    }

    /**
     * Creates a database type from a given column metadata.
     */
    normalizeType(column: {
        type?: ColumnType
        length?: number | string
        precision?: number | null
        scale?: number
        isArray?: boolean
    }): string {
        if (column.type === Number || column.type === "integer") {
            return "int"
        } else if (column.type === String) {
            return "varchar"
        } else if (column.type === Date) {
            return "datetime"
        } else if ((column.type as any) === Buffer) {
            return "blob"
        } else if (column.type === Boolean) {
            return "tinyint"
        } else if (column.type === "uuid" && !this.uuidColumnTypeSuported) {
            return "varchar"
        } else if (
            column.type === "json" &&
            !VersionUtils.isGreaterOrEqual(this.version ?? "0.0.0", "10.4.3")
        ) {
            /*
             * MariaDB implements this as a LONGTEXT rather, as the JSON data type contradicts the SQL standard,
             * and MariaDB's benchmarks indicate that performance is at least equivalent.
             *
             * @see https://mariadb.com/kb/en/json-data-type/
             * if Version is 10.4.3 or greater, JSON is an alias for longtext and an automatic check_json(column) constraint is added
             */
            return "longtext"
        } else if (
            column.type === "simple-array" ||
            column.type === "simple-json"
        ) {
            return "text"
        } else if (column.type === "simple-enum") {
            return "enum"
        } else if (
            column.type === "double precision" ||
            column.type === "real"
        ) {
            return "double"
        } else if (
            column.type === "dec" ||
            column.type === "numeric" ||
            column.type === "fixed"
        ) {
            return "decimal"
        } else if (column.type === "bool" || column.type === "boolean") {
            return "tinyint"
        } else if (
            column.type === "nvarchar" ||
            column.type === "national varchar"
        ) {
            return "varchar"
        } else if (column.type === "nchar" || column.type === "national char") {
            return "char"
        } else {
            return (column.type as string) || ""
        }
    }

    /**
     * Normalizes "default" value of the column.
     */
    normalizeDefault(columnMetadata: ColumnMetadata): string | undefined {
        const defaultValue = columnMetadata.default

        if (defaultValue === null) {
            return undefined
        }

        if (
            (columnMetadata.type === "enum" ||
                columnMetadata.type === "simple-enum" ||
                typeof defaultValue === "string") &&
            defaultValue !== undefined
        ) {
            return `'${defaultValue}'`
        }

        if (columnMetadata.type === "set" && defaultValue !== undefined) {
            return `'${DateUtils.simpleArrayToString(defaultValue)}'`
        }

        if (typeof defaultValue === "number") {
            return `'${defaultValue.toFixed(columnMetadata.scale)}'`
        }

        if (typeof defaultValue === "boolean") {
            return defaultValue ? "1" : "0"
        }

        if (typeof defaultValue === "function") {
            const value = defaultValue()
            return this.normalizeDatetimeFunction(value)
        }

        if (defaultValue === undefined) {
            return undefined
        }

        return `${defaultValue}`
    }

    /**
     * Compares "default" value of the column.
     * Postgres sorts json values before it is saved, so in that case a deep comparison has to be performed to see if has changed.
     */
    // private defaultEqual(
    //     columnMetadata: ColumnMetadata,
    //     tableColumn: TableColumn,
    // ): boolean {
    //     if (
    //         ["json", "jsonb"].includes(columnMetadata.type as string) &&
    //         !["function", "undefined"].includes(typeof columnMetadata.default)
    //     ) {
    //         const tableColumnDefault =
    //             typeof tableColumn.default === "string"
    //                 ? JSON.parse(
    //                       tableColumn.default.substring(
    //                           1,
    //                           tableColumn.default.length - 1,
    //                       ),
    //                   )
    //                 : tableColumn.default
    //
    //         return OrmUtils.deepCompare(
    //             columnMetadata.default,
    //             tableColumnDefault,
    //         )
    //     }
    //
    //     const columnDefault = this.lowerDefaultValueIfNecessary(
    //         this.normalizeDefault(columnMetadata),
    //     )
    //     return columnDefault === tableColumn.default
    // }

    /**
     * Normalizes "isUnique" value of the column.
     */
    normalizeIsUnique(column: ColumnMetadata): boolean {
        return column.entityMetadata.indices.some(
            (idx) =>
                idx.isUnique &&
                idx.columns.length === 1 &&
                idx.columns[0] === column,
        )
    }

    /**
     * Returns default column lengths, which is required on column creation.
     */
    getColumnLength(column: ColumnMetadata | TableColumn): string {
        if (column.length) return column.length.toString()

        /**
         * fix https://github.com/typeorm/typeorm/issues/1139
         * note that if the db did support uuid column type it wouldn't have been defaulted to varchar
         */
        if (
            column.generationStrategy === "uuid" &&
            !this.uuidColumnTypeSuported
        )
            return "36"

        switch (column.type) {
            case String:
            case "varchar":
            case "nvarchar":
            case "national varchar":
                return "255"
            case "varbinary":
                return "255"
            default:
                return ""
        }
    }

    /**
     * Creates column type definition including length, precision and scale
     */
    createFullType(column: TableColumn): string {
        let type = column.type

        // used 'getColumnLength()' method, because MySQL requires column length for `varchar`, `nvarchar` and `varbinary` data types
        if (this.getColumnLength(column)) {
            type += `(${this.getColumnLength(column)})`
        } else if (column.width) {
            type += `(${column.width})`
        } else if (
            column.precision !== null &&
            column.precision !== undefined &&
            column.scale !== null &&
            column.scale !== undefined
        ) {
            type += `(${column.precision},${column.scale})`
        } else if (
            column.precision !== null &&
            column.precision !== undefined
        ) {
            type += `(${column.precision})`
        }

        if (column.isArray) type += " array"

        return type
    }

    /**
     * Obtains a new database connection to a master server.
     * Used for replication.
     * If replication is not setup then returns default connection's database connection.
     */
    async obtainMasterConnection(): Promise<[any, Function]> {
        if (!this.master) {
            throw new TypeORMError("Driver not Connected")
        }

        return new Promise((ok, fail) => {
            this.master.connect((err: any, connection: any, release: any) => {
                err ? fail(err) : ok([connection, release])
            })
        })
    }

    /**
     * Obtains a new database connection to a slave server.
     * Used for replication.
     * If replication is not setup then returns master (default) connection's database connection.
     */
    async obtainSlaveConnection(): Promise<[any, Function]> {
        if (!this.slaves.length) {
            return this.obtainMasterConnection()
        }

        const random = Math.floor(Math.random() * this.slaves.length)

        return new Promise((ok, fail) => {
            this.slaves[random].connect(
                (err: any, connection: any, release: any) => {
                    err ? fail(err) : ok([connection, release])
                },
            )
        })
    }

    /**
     * Creates generated map of values generated or returned by database after INSERT query.
     *
     * todo: slow. optimize Object.keys(), OrmUtils.mergeDeep and column.createValueMap parts
     */
    createGeneratedMap(
        metadata: EntityMetadata,
        insertResult: ObjectLiteral,
        entityIndex: number,
    ) {
        if (!insertResult) {
            return undefined
        }

        if (insertResult.insertId === undefined) {
            return Object.keys(insertResult).reduce((map, key) => {
                const column = metadata.findColumnWithDatabaseName(key)
                if (column) {
                    OrmUtils.mergeDeep(
                        map,
                        column.createValueMap(insertResult[key]),
                    )
                    // OrmUtils.mergeDeep(map, column.createValueMap(this.prepareHydratedValue(insertResult[key], column))); // TODO: probably should be like there, but fails on enums, fix later
                }
                return map
            }, {} as ObjectLiteral)
        }

        const generatedMap = metadata.generatedColumns.reduce(
            (map, generatedColumn) => {
                let value: any
                if (
                    generatedColumn.generationStrategy === "increment" &&
                    insertResult.insertId
                ) {
                    // NOTE: When multiple rows is inserted by a single INSERT statement,
                    // `insertId` is the value generated for the first inserted row only.
                    value = insertResult.insertId + entityIndex
                    // } else if (generatedColumn.generationStrategy === "uuid") {
                    //     console.log("getting db value:", generatedColumn.databaseName);
                    //     value = generatedColumn.getEntityValue(uuidMap);
                }

                return OrmUtils.mergeDeep(
                    map,
                    generatedColumn.createValueMap(value),
                )
            },
            {} as ObjectLiteral,
        )

        return Object.keys(generatedMap).length > 0 ? generatedMap : undefined
    }

    /**
     * Differentiate columns of this table and columns from the given column metadatas columns
     * and returns only changed.
     */
    findChangedColumns(
        tableColumns: TableColumn[],
        columnMetadatas: ColumnMetadata[],
    ): ColumnMetadata[] {
        return columnMetadatas.filter((columnMetadata) => {
            const tableColumn = tableColumns.find(
                (c) => c.name === columnMetadata.databaseName,
            )
            if (!tableColumn) return false // we don't need new columns, we only need exist and changed

            const isColumnChanged =
                tableColumn.name !== columnMetadata.databaseName ||
                this.isColumnDataTypeChanged(tableColumn, columnMetadata) ||
                tableColumn.length !== this.getColumnLength(columnMetadata) ||
                tableColumn.width !== columnMetadata.width ||
                (columnMetadata.precision !== undefined &&
                    tableColumn.precision !== columnMetadata.precision) ||
                (columnMetadata.scale !== undefined &&
                    tableColumn.scale !== columnMetadata.scale) ||
                tableColumn.zerofill !== columnMetadata.zerofill ||
                tableColumn.unsigned !== columnMetadata.unsigned ||
                tableColumn.asExpression !== columnMetadata.asExpression ||
                tableColumn.generatedType !== columnMetadata.generatedType ||
                tableColumn.comment !==
                    this.escapeComment(columnMetadata.comment) ||
                !this.compareDefaultValues(
                    this.normalizeDefault(columnMetadata),
                    tableColumn.default,
                ) ||
                (tableColumn.enum &&
                    columnMetadata.enum &&
                    !OrmUtils.isArraysEqual(
                        tableColumn.enum,
                        columnMetadata.enum.map((val) => val + ""),
                    )) ||
                tableColumn.onUpdate !==
                    this.normalizeDatetimeFunction(columnMetadata.onUpdate) ||
                tableColumn.isPrimary !== columnMetadata.isPrimary ||
                !this.compareNullableValues(columnMetadata, tableColumn) ||
                tableColumn.isUnique !==
                    this.normalizeIsUnique(columnMetadata) ||
                (columnMetadata.generationStrategy !== "uuid" &&
                    tableColumn.isGenerated !== columnMetadata.isGenerated)

            // DEBUG SECTION
            // if (isColumnChanged) {
            //     console.log("table:", columnMetadata.entityMetadata.tableName)
            //     console.log(
            //         "name:",
            //         tableColumn.name,
            //         columnMetadata.databaseName,
            //     )
            //     console.log(
            //         "type:",
            //         tableColumn.type,
            //         this.normalizeType(columnMetadata),
            //     )
            //     console.log(
            //         "length:",
            //         tableColumn.length,
            //         columnMetadata.length,
            //     )
            //     console.log("width:", tableColumn.width, columnMetadata.width)
            //     console.log(
            //         "precision:",
            //         tableColumn.precision,
            //         columnMetadata.precision,
            //     )
            //     console.log("scale:", tableColumn.scale, columnMetadata.scale)
            //     console.log(
            //         "zerofill:",
            //         tableColumn.zerofill,
            //         columnMetadata.zerofill,
            //     )
            //     console.log(
            //         "unsigned:",
            //         tableColumn.unsigned,
            //         columnMetadata.unsigned,
            //     )
            //     console.log(
            //         "asExpression:",
            //         tableColumn.asExpression,
            //         columnMetadata.asExpression,
            //     )
            //     console.log(
            //         "generatedType:",
            //         tableColumn.generatedType,
            //         columnMetadata.generatedType,
            //     )
            //     console.log(
            //         "comment:",
            //         tableColumn.comment,
            //         this.escapeComment(columnMetadata.comment),
            //     )
            //     console.log(
            //         "default:",
            //         tableColumn.default,
            //         this.normalizeDefault(columnMetadata),
            //     )
            //     console.log("enum:", tableColumn.enum, columnMetadata.enum)
            //     console.log(
            //         "default changed:",
            //         !this.compareDefaultValues(
            //             this.normalizeDefault(columnMetadata),
            //             tableColumn.default,
            //         ),
            //     )
            //     console.log(
            //         "isPrimary:",
            //         tableColumn.isPrimary,
            //         columnMetadata.isPrimary,
            //     )
            //     console.log(
            //         "isNullable changed:",
            //         !this.compareNullableValues(columnMetadata, tableColumn),
            //     )
            //     console.log(
            //         "isUnique:",
            //         tableColumn.isUnique,
            //         this.normalizeIsUnique(columnMetadata),
            //     )
            //     console.log(
            //         "isGenerated:",
            //         tableColumn.isGenerated,
            //         columnMetadata.isGenerated,
            //     )
            //     console.log(
            //         columnMetadata.generationStrategy !== "uuid" &&
            //             tableColumn.isGenerated !== columnMetadata.isGenerated,
            //     )
            //     console.log("==========================================")
            // }

            return isColumnChanged
        })
    }

    // private lowerDefaultValueIfNecessary(value: string | undefined) {
    //     // Postgres saves function calls in default value as lowercase #2733
    //     if (!value) {
    //         return value
    //     }
    //     return value
    //         .split(`'`)
    //         .map((v, i) => {
    //             return i % 2 === 1 ? v : v.toLowerCase()
    //         })
    //         .join(`'`)
    // }

    /**
     * Returns true if driver supports RETURNING / OUTPUT statement.
     */
    isReturningSqlSupported(returningType: ReturningType): boolean {
        return this._isReturningSqlSupported[returningType]
    }

    /**
     * Returns true if driver supports uuid values generation on its own.
     */
    isUUIDGenerationSupported(): boolean {
        return false
    }

    /**
     * Returns true if driver supports fulltext indices.
     */
    isFullTextColumnTypeSupported(): boolean {
        return true
    }

    get uuidGenerator(): string {
        return this.options.uuidExtension === "pgcrypto"
            ? "gen_random_uuid()"
            : "uuid_generate_v4()"
    }

    /**
     * Creates an escaped parameter.
     */
    createParameter(parameterName: string, index: number): string {
        return "?"
    }

    // -------------------------------------------------------------------------
    // Public Methods
    // -------------------------------------------------------------------------

    /**
     * Loads postgres query stream package.
     */
    loadStreamDependency() {
        try {
            return PlatformTools.load("pg-query-stream")
        } catch (e) {
            // todo: better error for browser env
            throw new TypeORMError(
                `To use streams you should install pg-query-stream package. Please run npm i pg-query-stream --save command.`,
            )
        }
    }

    // -------------------------------------------------------------------------
    // Protected Methods
    // -------------------------------------------------------------------------

    /**
     * If driver dependency is not given explicitly, then try to load it via "require".
     */
    protected loadDependencies(): void {
        try {
            const postgres = this.options.driver || PlatformTools.load("pg")
            this.postgres = postgres
            try {
                const pgNative =
                    this.options.nativeDriver || PlatformTools.load("pg-native")
                if (pgNative && this.postgres.native)
                    this.postgres = this.postgres.native
            } catch (e) {}
        } catch (e) {
            // todo: better error for browser env
            throw new DriverPackageNotInstalledError("Postgres", "pg")
        }
    }

    /**
     * Creates a new connection pool for a given database credentials.
     */
    protected async createPool(
        options: KingBaseConnectionOptions,
        credentials: KingBaseConnectionCredentialsOptions,
    ): Promise<any> {
        const { logger } = this.connection
        credentials = Object.assign({}, credentials)

        // build connection options for the driver
        // See: https://github.com/brianc/node-postgres/tree/master/packages/pg-pool#create
        const connectionOptions = Object.assign(
            {},
            {
                connectionString: credentials.url,
                host: credentials.host,
                user: credentials.username,
                password: credentials.password,
                database: credentials.database,
                port: credentials.port,
                ssl: credentials.ssl,
                connectionTimeoutMillis: options.connectTimeoutMS,
                application_name: options.applicationName,
                max: options.poolSize,
            },
            options.extra || {},
        )

        if (options.parseInt8 !== undefined) {
            if (
                this.postgres.defaults &&
                Object.getOwnPropertyDescriptor(
                    this.postgres.defaults,
                    "parseInt8",
                )?.set
            ) {
                this.postgres.defaults.parseInt8 = options.parseInt8
            } else {
                logger.log(
                    "warn",
                    "Attempted to set parseInt8 option, but the postgres driver does not support setting defaults.parseInt8. This option will be ignored.",
                )
            }
        }

        // create a connection pool
        const pool = new this.postgres.Pool(connectionOptions)

        const poolErrorHandler =
            options.poolErrorHandler ||
            ((error: any) =>
                logger.log("warn", `Postgres pool raised an error. ${error}`))

        /*
          Attaching an error handler to pool errors is essential, as, otherwise, errors raised will go unhandled and
          cause the hosting app to crash.
         */
        pool.on("error", poolErrorHandler)

        return new Promise((ok, fail) => {
            pool.connect((err: any, connection: any, release: Function) => {
                if (err) return fail(err)

                if (options.logNotifications) {
                    connection.on("notice", (msg: any) => {
                        msg && this.connection.logger.log("info", msg.message)
                    })
                    connection.on("notification", (msg: any) => {
                        msg &&
                            this.connection.logger.log(
                                "info",
                                `Received NOTIFY on channel ${msg.channel}: ${msg.payload}.`,
                            )
                    })
                }
                release()
                ok(pool)
            })
        })
    }

    /**
     * Closes connection pool.
     */
    protected async closePool(pool: any): Promise<void> {
        while (this.connectedQueryRunners.length) {
            await this.connectedQueryRunners[0].release()
        }

        return new Promise<void>((ok, fail) => {
            pool.end((err: any) => (err ? fail(err) : ok()))
        })
    }

    /**
     * Executes given query.
     */
    protected executeQuery(connection: any, query: string) {
        this.connection.logger.logQuery(query)

        return new Promise((ok, fail) => {
            connection.query(query, (err: any, result: any) =>
                err ? fail(err) : ok(result),
            )
        })
    }

    /**
     * Checks if "DEFAULT" values in the column metadata and in the database are equal.
     */
    protected compareDefaultValues(
        columnMetadataValue: string | undefined,
        databaseValue: string | undefined,
    ): boolean {
        if (
            typeof columnMetadataValue === "string" &&
            typeof databaseValue === "string"
        ) {
            // we need to cut out "'" because in mysql we can understand returned value is a string or a function
            // as result compare cannot understand if default is really changed or not
            columnMetadataValue = columnMetadataValue.replace(/^'+|'+$/g, "")
            databaseValue = databaseValue.replace(/^'+|'+$/g, "")
        }

        return columnMetadataValue === databaseValue
    }

    compareNullableValues(
        columnMetadata: ColumnMetadata,
        tableColumn: TableColumn,
    ): boolean {
        return columnMetadata.isNullable === tableColumn.isNullable
    }

    /**
     * If parameter is a datetime function, e.g. "CURRENT_TIMESTAMP", normalizes it.
     * Otherwise returns original input.
     */
    protected normalizeDatetimeFunction(value?: string) {
        if (!value) return value

        // check if input is datetime function
        const isDatetimeFunction =
            value.toUpperCase().indexOf("CURRENT_TIMESTAMP") !== -1 ||
            value.toUpperCase().indexOf("NOW") !== -1

        if (isDatetimeFunction) {
            // extract precision, e.g. "(3)"
            const precision = value.match(/\(\d+\)/)

            return precision
                ? `CURRENT_TIMESTAMP${precision[0]}`
                : "CURRENT_TIMESTAMP"
        } else {
            return value
        }
    }

    /**
     * Escapes a given comment.
     */
    protected escapeComment(comment?: string) {
        if (!comment) return comment

        comment = comment.replace(/\u0000/g, "") // Null bytes aren't allowed in comments

        return comment
    }

    /**
     * A helper to check if column data types have changed
     * This can be used to manage checking any types the
     * database may alias
     */
    private isColumnDataTypeChanged(
        tableColumn: TableColumn,
        columnMetadata: ColumnMetadata,
    ) {
        // this is an exception for mariadb versions where json is an alias for longtext
        if (
            this.normalizeType(columnMetadata) === "json" &&
            tableColumn.type.toLowerCase() === "longtext"
        )
            return false
        return tableColumn.type !== this.normalizeType(columnMetadata)
    }
}
