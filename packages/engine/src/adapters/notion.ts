/**
 * Notion Adapter
 *
 * Handles all Notion API interactions for database read/write operations.
 * Supports bidirectional sync with property mapping and type conversion.
 */

const NOTION_API_VERSION = "2022-06-28";
const NOTION_API_BASE = "https://api.notion.com/v1";

export interface NotionConfig {
  apiToken: string;
}

export interface NotionProperty {
  id: string;
  name: string;
  type: string;
  [key: string]: any;
}

export interface NotionPage {
  id: string;
  created_time: string;
  last_edited_time: string;
  properties: Record<string, any>;
  url: string;
}

export interface NotionDatabase {
  id: string;
  title: string;
  properties: Record<string, NotionProperty>;
  url: string;
}

export interface NotionRow {
  id: string;
  created_at: string;
  updated_at: string;
  properties: Record<string, any>;
}

/**
 * Notion API client for database operations
 */
export class NotionAdapter {
  private apiToken: string;

  constructor(config: NotionConfig) {
    this.apiToken = config.apiToken;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: any
  ): Promise<T> {
    const url = `${NOTION_API_BASE}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiToken}`,
      "Notion-Version": NOTION_API_VERSION,
      "Content-Type": "application/json",
    };

    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(`Notion API error: ${error.message || res.status}`);
    }

    return res.json();
  }

  /**
   * Get database schema (properties)
   */
  async getDatabase(databaseId: string): Promise<NotionDatabase> {
    const db = await this.request<any>("GET", `/databases/${databaseId}`);
    return {
      id: db.id,
      title: db.title?.[0]?.plain_text || "Untitled",
      properties: db.properties,
      url: db.url,
    };
  }

  /**
   * Query all pages from a database
   */
  async queryDatabase(
    databaseId: string,
    options: {
      filter?: any;
      sorts?: any[];
      pageSize?: number;
    } = {}
  ): Promise<NotionRow[]> {
    const rows: NotionRow[] = [];
    let cursor: string | undefined;

    do {
      const body: any = {
        page_size: options.pageSize || 100,
      };
      if (options.filter) body.filter = options.filter;
      if (options.sorts) body.sorts = options.sorts;
      if (cursor) body.start_cursor = cursor;

      const res = await this.request<any>(
        "POST",
        `/databases/${databaseId}/query`,
        body
      );

      for (const page of res.results) {
        rows.push({
          id: page.id,
          created_at: page.created_time,
          updated_at: page.last_edited_time,
          properties: this.extractProperties(page.properties),
        });
      }

      cursor = res.has_more ? res.next_cursor : undefined;
    } while (cursor);

    return rows;
  }

  /**
   * Get a single page by ID
   */
  async getPage(pageId: string): Promise<NotionRow> {
    const page = await this.request<any>("GET", `/pages/${pageId}`);
    return {
      id: page.id,
      created_at: page.created_time,
      updated_at: page.last_edited_time,
      properties: this.extractProperties(page.properties),
    };
  }

  /**
   * Create a new page in a database
   */
  async createPage(
    databaseId: string,
    properties: Record<string, any>
  ): Promise<NotionRow> {
    const page = await this.request<any>("POST", "/pages", {
      parent: { database_id: databaseId },
      properties: this.formatProperties(properties),
    });

    return {
      id: page.id,
      created_at: page.created_time,
      updated_at: page.last_edited_time,
      properties: this.extractProperties(page.properties),
    };
  }

  /**
   * Update an existing page
   */
  async updatePage(
    pageId: string,
    properties: Record<string, any>
  ): Promise<NotionRow> {
    const page = await this.request<any>("PATCH", `/pages/${pageId}`, {
      properties: this.formatProperties(properties),
    });

    return {
      id: page.id,
      created_at: page.created_time,
      updated_at: page.last_edited_time,
      properties: this.extractProperties(page.properties),
    };
  }

  /**
   * Archive (soft delete) a page
   */
  async archivePage(pageId: string): Promise<void> {
    await this.request("PATCH", `/pages/${pageId}`, {
      archived: true,
    });
  }

  /**
   * Extract plain values from Notion property objects
   */
  private extractProperties(
    properties: Record<string, any>
  ): Record<string, any> {
    const result: Record<string, any> = {};

    for (const [name, prop] of Object.entries(properties)) {
      result[name] = this.extractPropertyValue(prop);
    }

    return result;
  }

  /**
   * Extract a single property value
   */
  private extractPropertyValue(prop: any): any {
    switch (prop.type) {
      case "title":
        return prop.title?.[0]?.plain_text || "";

      case "rich_text":
        return prop.rich_text?.[0]?.plain_text || "";

      case "number":
        return prop.number;

      case "select":
        return prop.select?.name || null;

      case "multi_select":
        return prop.multi_select?.map((s: any) => s.name) || [];

      case "status":
        return prop.status?.name || null;

      case "date":
        return prop.date?.start || null;

      case "checkbox":
        return prop.checkbox || false;

      case "url":
        return prop.url || null;

      case "email":
        return prop.email || null;

      case "phone_number":
        return prop.phone_number || null;

      case "formula":
        return this.extractFormulaValue(prop.formula);

      case "relation":
        return prop.relation?.map((r: any) => r.id) || [];

      case "rollup":
        return this.extractRollupValue(prop.rollup);

      case "people":
        return prop.people?.map((p: any) => p.id) || [];

      case "files":
        return prop.files?.map((f: any) => f.file?.url || f.external?.url) || [];

      case "created_time":
        return prop.created_time;

      case "last_edited_time":
        return prop.last_edited_time;

      case "created_by":
        return prop.created_by?.id;

      case "last_edited_by":
        return prop.last_edited_by?.id;

      case "unique_id":
        return prop.unique_id?.number;

      default:
        return null;
    }
  }

  private extractFormulaValue(formula: any): any {
    switch (formula?.type) {
      case "string":
        return formula.string;
      case "number":
        return formula.number;
      case "boolean":
        return formula.boolean;
      case "date":
        return formula.date?.start;
      default:
        return null;
    }
  }

  private extractRollupValue(rollup: any): any {
    switch (rollup?.type) {
      case "number":
        return rollup.number;
      case "date":
        return rollup.date?.start;
      case "array":
        return rollup.array?.map((item: any) => this.extractPropertyValue(item));
      default:
        return null;
    }
  }

  /**
   * Format plain values into Notion property objects
   */
  private formatProperties(
    properties: Record<string, any>
  ): Record<string, any> {
    const result: Record<string, any> = {};

    for (const [name, value] of Object.entries(properties)) {
      if (value === undefined) continue;

      // Detect type from value and format accordingly
      const formatted = this.formatPropertyValue(name, value);
      if (formatted) {
        result[name] = formatted;
      }
    }

    return result;
  }

  /**
   * Format a single property value for Notion API
   */
  private formatPropertyValue(
    name: string,
    value: any
  ): any {
    // Handle explicit type annotations: { type: "select", value: "Option" }
    if (value && typeof value === "object" && "type" in value && "value" in value) {
      return this.formatTypedValue(value.type, value.value);
    }

    // Infer type from value
    if (typeof value === "string") {
      // Check if it looks like a title (commonly named "Name" or "Title")
      if (name.toLowerCase() === "name" || name.toLowerCase() === "title") {
        return { title: [{ text: { content: value } }] };
      }
      return { rich_text: [{ text: { content: value } }] };
    }

    if (typeof value === "number") {
      return { number: value };
    }

    if (typeof value === "boolean") {
      return { checkbox: value };
    }

    if (Array.isArray(value)) {
      // Assume multi-select for string arrays
      if (value.every((v) => typeof v === "string")) {
        return { multi_select: value.map((v) => ({ name: v })) };
      }
      // Assume relation for UUID-like string arrays
      if (value.every((v) => typeof v === "string" && v.includes("-"))) {
        return { relation: value.map((id) => ({ id })) };
      }
    }

    if (value instanceof Date) {
      return { date: { start: value.toISOString() } };
    }

    if (typeof value === "object" && value !== null) {
      // Check for date object
      if ("start" in value) {
        return { date: value };
      }
    }

    return null;
  }

  /**
   * Format a value with explicit type
   */
  private formatTypedValue(type: string, value: any): any {
    switch (type) {
      case "title":
        return { title: [{ text: { content: String(value) } }] };

      case "rich_text":
        return { rich_text: [{ text: { content: String(value) } }] };

      case "number":
        return { number: Number(value) };

      case "select":
        return { select: value ? { name: String(value) } : null };

      case "multi_select":
        return {
          multi_select: (Array.isArray(value) ? value : [value]).map((v) => ({
            name: String(v),
          })),
        };

      case "status":
        return { status: { name: String(value) } };

      case "date":
        return {
          date: typeof value === "string" ? { start: value } : value,
        };

      case "checkbox":
        return { checkbox: Boolean(value) };

      case "url":
        return { url: value ? String(value) : null };

      case "email":
        return { email: value ? String(value) : null };

      case "phone_number":
        return { phone_number: value ? String(value) : null };

      case "relation":
        return {
          relation: (Array.isArray(value) ? value : [value]).map((id) => ({ id })),
        };

      default:
        return null;
    }
  }
}

/**
 * Create a Notion adapter from environment
 */
export function createNotionAdapter(apiToken: string): NotionAdapter {
  return new NotionAdapter({ apiToken });
}
