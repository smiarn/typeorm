import { QueryRunner } from "../query-runner/QueryRunner"
import { ColumnMetadata } from "../metadata/ColumnMetadata"
import { ObjectLiteral } from "../common/ObjectLiteral"
import { ColumnType } from "./types/ColumnTypes"
import { CteCapabilities } from "./types/CteCapabilities"
import { MappedColumnTypes } from "./types/MappedColumnTypes"
import { SchemaBuilder } from "../schema-builder/SchemaBuilder"
import { DataTypeDefaults } from "./types/DataTypeDefaults"
import { BaseDataSourceOptions } from "../data-source/BaseDataSourceOptions"
import { TableColumn } from "../schema-builder/table/TableColumn"
import { EntityMetadata } from "../metadata/EntityMetadata"
import { ReplicationMode } from "./types/ReplicationMode"
import { Table } from "../schema-builder/table/Table"
import { View } from "../schema-builder/view/View"
import { TableForeignKey } from "../schema-builder/table/TableForeignKey"
import { UpsertType } from "./types/UpsertType"
import { OnDeleteType } from "../metadata/types/OnDeleteType"
import { OnUpdateType } from "../metadata/types/OnUpdateType"

export type ReturningType = "insert" | "update" | "delete"

/**
 * Driver 负责组织 TypeORM 与特定数据库管理系统的通信。
 */
export interface Driver {
    /**
     * 连接选项。
     */
    options: BaseDataSourceOptions

    /**
     * 数据库版本/发行版。通常需要向数据库发送 SQL 查询，因此并不总是设置
     */
    version?: string

    /**
     * 用于执行所有写查询的数据库名称。
     *
     * todo: 可能会移到查询运行器中。
     */
    database?: string

    /**
     * 用于执行所有写查询的模式名称。
     */
    schema?: string

    /**
     * 指示是否启用了复制。
     */
    isReplicated: boolean

    /**
     * 指示此驱动程序是否支持树表。
     */
    treeSupport: boolean

    /**
     * 表示此驱动程序支持的事务类型
     */
    transactionSupport: "simple" | "nested" | "none"

    /**
     * 获取驱动程序支持的列数据类型列表。
     */
    supportedDataTypes: ColumnType[]

    /**
     * 返回驱动程序支持的 upsert 类型（如果有）
     */
    supportedUpsertTypes: UpsertType[]

    /**
     * 返回驱动程序支持的 onDelete 类型列表
     */
    supportedOnDeleteTypes?: OnDeleteType[]

    /**
     * 返回驱动程序支持的 onUpdate 类型列表
     */
    supportedOnUpdateTypes?: OnUpdateType[]

    /**
     * 长度、精度和小数位数的默认值取决于列数据类型。
     * 用于用户未指定长度/精度/小数位数的情况。
     */
    dataTypeDefaults: DataTypeDefaults

    /**
     * 获取空间列数据类型列表。
     */
    spatialTypes: ColumnType[]

    /**
     * 获取驱动程序支持长度的列数据类型列表。
     */
    withLengthColumnTypes: ColumnType[]

    /**
     * 获取驱动程序支持精度的列数据类型列表。
     */
    withPrecisionColumnTypes: ColumnType[]

    /**
     * 获取驱动程序支持小数位数的列数据类型列表。
     */
    withScaleColumnTypes: ColumnType[]

    /**
     * ORM 有特殊列，我们需要知道这些类型对应的数据库列类型应该是什么。
     * 列类型取决于驱动程序。
     */
    mappedDataTypes: MappedColumnTypes

    /**
     * 数据库管理系统允许的别名最大长度（查询执行）。
     */
    maxAliasLength?: number

    cteCapabilities: CteCapabilities

    /**
     * 虚拟表名
     */
    dummyTableName?: string

    /**
     * 执行与数据库的连接。
     * 根据驱动程序类型，它可能会创建一个连接池。
     */
    connect(): Promise<void>

    /**
     * 连接后执行任何操作（例如在 Postgres 驱动程序中创建扩展）。
     */
    afterConnect(): Promise<void>

    /**
     * 关闭与数据库的连接并释放所有资源。
     */
    disconnect(): Promise<void>

    /**
     * 同步数据库模式（创建表、索引等）。
     */
    createSchemaBuilder(): SchemaBuilder

    /**
     * 创建用于普通查询的查询运行器。
     */
    createQueryRunner(mode: ReplicationMode): QueryRunner

    /**
     * 用特殊的转义字符替换给定 SQL 中的参数
     * 以及要传递给查询的参数名称数组。
     */
    escapeQueryWithParameters(
        sql: string,
        parameters: ObjectLiteral,
        nativeParameters: ObjectLiteral,
    ): [string, any[]]

    /**
     * 转义表名、列名或别名。
     *
     * todo: 转义应该能够处理名称中的点并自动转义它们
     */
    escape(name: string): string

    /**
     * 使用数据库名称、模式名称和表名构建完整表名。
     * 例如：myDB.mySchema.myTable
     */
    buildTableName(
        tableName: string,
        schema?: string,
        database?: string,
    ): string

    /**
     * 解析目标表名或其他类型并返回标准化的表定义。
     */
    parseTableName(
        target: EntityMetadata | Table | View | TableForeignKey | string,
    ): { tableName: string; schema?: string; database?: string }

    /**
     * 根据列类型和元数据，准备给定值以进行持久化。
     */
    preparePersistentValue(value: any, column: ColumnMetadata): any

    /**
     * 根据列类型，准备给定值以进行持久化。
     */
    prepareHydratedValue(value: any, column: ColumnMetadata): any

    /**
     * 将给定列的类型转换为数据库列类型。
     */
    normalizeType(column: {
        type?: ColumnType | string
        length?: number | string
        precision?: number | null
        scale?: number
        isArray?: boolean
    }): string

    /**
     * 规范化列的 "default" 值。
     */
    normalizeDefault(columnMetadata: ColumnMetadata): string | undefined

    /**
     * 规范化列的 "isUnique" 值。
     */
    normalizeIsUnique(column: ColumnMetadata): boolean

    /**
     * 计算列长度，考虑默认长度值。
     */
    getColumnLength(column: ColumnMetadata): string

    /**
     * 规范化列的 "default" 值。
     */
    createFullType(column: TableColumn): string

    /**
     * 获取到主服务器的新数据库连接。
     * 用于复制。
     * 如果未设置复制，则返回默认连接的数据库连接。
     */
    obtainMasterConnection(): Promise<any>

    /**
     * 获取到从服务器的新数据库连接。
     * 用于复制。
     * 如果未设置复制，则返回主（默认）连接的数据库连接。
     */
    obtainSlaveConnection(): Promise<any>

    /**
     * 创建由数据库在 INSERT 查询后生成或返回的值的映射。
     */
    createGeneratedMap(
        metadata: EntityMetadata,
        insertResult: any,
        entityIndex?: number,
        entityNum?: number,
    ): ObjectLiteral | undefined

    /**
     * 区分此表的列和给定列元数据的列
     * 并仅返回已更改的列。
     */
    findChangedColumns(
        tableColumns: TableColumn[],
        columnMetadatas: ColumnMetadata[],
    ): ColumnMetadata[]

    /**
     * 如果驱动程序支持 RETURNING / OUTPUT 语句，则返回 true。
     */
    isReturningSqlSupported(returningType: ReturningType): boolean

    /**
     * 如果驱动程序自己支持 UUID 值生成，则返回 true。
     */
    isUUIDGenerationSupported(): boolean

    /**
     * 如果驱动程序支持全文索引，则返回 true。
     */
    isFullTextColumnTypeSupported(): boolean

    /**
     * 创建一个转义参数。
     */
    createParameter(parameterName: string, index: number): string
}
