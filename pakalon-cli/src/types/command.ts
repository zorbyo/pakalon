export interface LocalCommandCall {
  (args?: string): Promise<{ type: 'text'; value: string }>
}
