import { describe, it, expect, vi } from 'vitest'
import http from 'node:http'
import { handleGetPortalWidget, handleRotatePortalWidgetToken, handleUpdatePortalWidgetConfig } from '../src/api/portalWidget.js'
import { handleWidgetRequest } from '../src/api/widget.js'

describe('Widget API Endpoints & CORS', () => {
  it('deve responder requisições OPTIONS com status 204 e headers CORS', async () => {
    const req = {
      method: 'OPTIONS',
      headers: { origin: 'https://portal.reputei.com.br' }
    } as unknown as http.IncomingMessage

    let statusCode = 0
    const headers: Record<string, string> = {}

    const res = {
      writeHead: vi.fn((status: number, h?: Record<string, string>) => {
        statusCode = status
        if (h) Object.assign(headers, h)
      }),
      setHeader: vi.fn((key: string, val: string) => {
        headers[key] = val
      }),
      end: vi.fn()
    } as unknown as http.ServerResponse

    await handleGetPortalWidget(req, res)
    expect(statusCode).toBe(204)
    expect(headers['Access-Control-Allow-Origin']).toBeTruthy()
  })

  it('deve responder OPTIONS no endpoint público do widget /api/widget/:token', async () => {
    const req = {
      method: 'OPTIONS',
      url: '/api/widget/test-token-123',
      headers: {}
    } as unknown as http.IncomingMessage

    let statusCode = 0
    const headers: Record<string, string> = {}

    const res = {
      writeHead: vi.fn((status: number) => {
        statusCode = status
      }),
      setHeader: vi.fn((key: string, val: string) => {
        headers[key] = val
      }),
      end: vi.fn()
    } as unknown as http.ServerResponse

    await handleWidgetRequest(req, res)
    expect(statusCode).toBe(204)
    expect(headers['Access-Control-Allow-Origin']).toBe('*')
  })
})
