import { startRegistration, startAuthentication } from '@simplewebauthn/browser'
import type { AuthResponse } from '../types/AuthResponse'
import type { UserStatus } from '../types/UserStatus'
import type { PendingCertificate } from '../types/PendingCertificate'
import type { ActiveMember } from '../types/ActiveMember'
import type { VerificationToken } from '../types/VerificationToken'
import type { PendingContract } from '../types/PendingContract'
import type { Event } from '../types/Event'
import type { ShiftInfo } from '../types/ShiftInfo'
import type { UserShift } from '../types/UserShift'
import type { BarHours } from '../types/BarHours'
import type { OverviewStats } from '../types/OverviewStats'
import type { UserOverview } from '../types/UserOverview'
import type { UserListItem } from '../types/UserListItem'
import type { BulkImportResult } from '../types/BulkImportResult'
import type { InductionDate } from '../types/InductionDate'
import type { PendingInductionApproval } from '../types/PendingInductionApproval'

const API_BASE = window.location.origin

export class AuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthError'
  }
}

/**
 * Register a new user with a passkey
 */
export async function registerWithPasskey(displayName: string, email?: string): Promise<AuthResponse> {
  try {
    // 1. Start registration - get challenge from backend
    const startResponse = await fetch(`${API_BASE}/api/auth/register/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ display_name: displayName, email: email || null }),
    })

    if (!startResponse.ok) {
      const error = await startResponse.json()
      throw new AuthError(error.error || 'Failed to start registration')
    }

    const optionsResponse = await startResponse.json()

    // 2. Create credential with browser/authenticator
    // SimpleWebAuthn v13+ expects { optionsJSON: publicKey }
    const credential = await startRegistration({
      optionsJSON: optionsResponse.publicKey || optionsResponse
    })

    // 3. Finish registration - send public key to backend
    const finishResponse = await fetch(`${API_BASE}/api/auth/register/finish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credential),
    })

    if (!finishResponse.ok) {
      const error = await finishResponse.json()
      throw new AuthError(error.error || 'Failed to finish registration')
    }

    const authResponse: AuthResponse = await finishResponse.json()

    // Store token
    localStorage.setItem('auth_token', authResponse.token)
    localStorage.setItem('user_id', authResponse.user_id)
    localStorage.setItem('is_committee', authResponse.is_committee.toString())
    localStorage.setItem('is_admin', authResponse.is_admin.toString())

    // Reload to reflect new auth state
    window.location.reload()

    return authResponse
  } catch (error) {
    if (error instanceof AuthError) {
      throw error
    }
    throw new AuthError(error instanceof Error ? error.message : 'Registration failed')
  }
}

/**
 * Authenticate an existing user with their passkey
 */
export async function loginWithPasskey(): Promise<AuthResponse> {
  try {
    // 1. Start login - get challenge from backend
    const startResponse = await fetch(`${API_BASE}/api/auth/login/start`, {
      method: 'POST',
    })

    if (!startResponse.ok) {
      const error = await startResponse.json()
      throw new AuthError(error.error || 'Failed to start login')
    }

    const optionsResponse = await startResponse.json()

    // 2. Sign challenge with authenticator
    // SimpleWebAuthn v13+ expects { optionsJSON: publicKey }
    const credential = await startAuthentication({
      optionsJSON: optionsResponse.publicKey || optionsResponse
    })

    // 3. Finish login - verify signature
    const finishResponse = await fetch(`${API_BASE}/api/auth/login/finish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credential),
    })

    if (!finishResponse.ok) {
      const error = await finishResponse.json()
      throw new AuthError(error.error || 'Failed to finish login')
    }

    const authResponse: AuthResponse = await finishResponse.json()

    // Store token
    localStorage.setItem('auth_token', authResponse.token)
    localStorage.setItem('user_id', authResponse.user_id)
    localStorage.setItem('is_committee', authResponse.is_committee.toString())
    localStorage.setItem('is_admin', authResponse.is_admin.toString())

    // Reload to reflect new auth state
    window.location.reload()

    return authResponse
  } catch (error) {
    if (error instanceof AuthError) {
      throw error
    }
    throw new AuthError(error instanceof Error ? error.message : 'Login failed')
  }
}

/**
 * Logout - clear stored credentials
 */
export function logout(): void {
  localStorage.removeItem('auth_token')
  localStorage.removeItem('user_id')
  localStorage.removeItem('is_committee')
  localStorage.removeItem('is_admin')

  // Reload to reflect logged out state
  window.location.reload()
}

/**
 * Check if user is logged in
 */
export function isLoggedIn(): boolean {
  return localStorage.getItem('auth_token') !== null
}

/**
 * Get stored auth token
 */
export function getAuthToken(): string | null {
  return localStorage.getItem('auth_token')
}

/**
 * Get stored user ID
 */
export function getUserId(): string | null {
  return localStorage.getItem('user_id')
}

/**
 * Check if user is committee member
 */
export function isCommittee(): boolean {
  return localStorage.getItem('is_committee') === 'true'
}

/**
 * Check if user is admin
 */
export function isAdmin(): boolean {
  return localStorage.getItem('is_admin') === 'true'
}

/**
 * Make authenticated API request
 */
export async function authenticatedFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = getAuthToken()

  if (!token) {
    throw new AuthError('Not authenticated')
  }

  const response = await fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      'Authorization': `Bearer ${token}`,
    },
  })

  if (response.status === 401) {
    localStorage.removeItem('auth_token')
    localStorage.removeItem('user_id')
    localStorage.removeItem('is_committee')
    localStorage.removeItem('is_admin')
    window.location.reload()
  }

  return response
}

type RotaPredicateFields = Pick<
  UserStatus,
  'induction_completed' | 'code_of_conduct_signed' | 'food_safety_completed' | 'supervised_shift_completed'
>

// Sign-up gate. Excludes supervised_shift_completed because the supervised
// shift is itself completed via a booking — gating on it would deadlock new
// members.
export function canSignupForShifts(u: RotaPredicateFields): boolean {
  return u.induction_completed && u.code_of_conduct_signed && u.food_safety_completed
}

// Full active rota member: eligible for allocation and counted in active rosters.
export function isRotaMember(u: RotaPredicateFields): boolean {
  return canSignupForShifts(u) && u.supervised_shift_completed
}

/**
 * Get current user's status
 */
export async function getUserStatus(): Promise<UserStatus> {
  const response = await authenticatedFetch(`${API_BASE}/api/users/me`)

  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to get user status')
  }

  return response.json()
}

/**
 * Accept Code of Conduct
 */
export async function acceptCodeOfConduct(): Promise<void> {
  const response = await authenticatedFetch(`${API_BASE}/api/users/me/accept-coc`, {
    method: 'POST',
  })

  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to accept Code of Conduct')
  }
}

/**
 * Upload food safety certificate
 */
export async function uploadCertificate(file: File): Promise<void> {
  const formData = new FormData()
  formData.append('certificate', file)

  const token = getAuthToken()
  if (!token) {
    throw new AuthError('Not authenticated')
  }

  const response = await fetch(`${API_BASE}/api/users/me/food-safety-certificate`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
    body: formData,
  })

  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to upload certificate')
  }
}


/**
 * Get pending food safety certificates (committee only)
 */
export async function getPendingCertificates(): Promise<PendingCertificate[]> {
  const response = await authenticatedFetch(`${API_BASE}/api/admin/pending-certificates`)

  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to get pending certificates')
  }

  return response.json()
}

export interface CertificateData {
  url: string
  contentType: string
}

/**
 * Get certificate URL and content type for viewing (with auth header)
 */
export async function getCertificateData(userId: string): Promise<CertificateData> {
  const response = await authenticatedFetch(`${API_BASE}/api/admin/certificate/${userId}`)

  if (!response.ok) {
    throw new AuthError('Failed to fetch certificate')
  }

  const contentType = response.headers.get('content-type') || 'image/jpeg'
  const blob = await response.blob()
  return {
    url: URL.createObjectURL(blob),
    contentType,
  }
}

/**
 * Approve food safety certificate (committee only)
 */
export async function approveCertificate(userId: string): Promise<void> {
  const response = await authenticatedFetch(`${API_BASE}/api/admin/approve-food-safety/${userId}`, {
    method: 'POST',
  })

  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to approve certificate')
  }
}


/**
 * Get verification token for QR code
 */
export async function getVerificationToken(type: 'induction' | 'food_safety'): Promise<string> {
  const response = await authenticatedFetch(`${API_BASE}/api/users/me/verification-token?type=${type}`)

  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to get verification token')
  }

  const data: VerificationToken = await response.json()
  return data.token
}

/**
 * Verify induction via QR code (committee only)
 */
export async function verifyInduction(token: string): Promise<void> {
  const response = await authenticatedFetch(`${API_BASE}/api/admin/verify-induction`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ token }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to verify induction')
  }
}

/**
 * Update display name
 */
export async function updateDisplayName(displayName: string): Promise<void> {
  const response = await authenticatedFetch(`${API_BASE}/api/users/me/display-name`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ display_name: displayName }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to update display name')
  }
}

/**
 * Get all active members (committee only)
 */
export async function getActiveMembers(): Promise<ActiveMember[]> {
  const response = await authenticatedFetch(`${API_BASE}/api/admin/active-members`)

  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to get active members')
  }

  return response.json()
}

import type { UnallocatedMember } from '../types/UnallocatedMember'
export type { UnallocatedMember }

/**
 * Get rota members with no shift signups in the given date range. Committee only.
 */
export async function getUnallocatedMembers(
  startDate: string,
  endDate: string,
): Promise<UnallocatedMember[]> {
  const params = new URLSearchParams({ start_date: startDate, end_date: endDate })
  const response = await authenticatedFetch(
    `${API_BASE}/api/admin/unallocated-users?${params.toString()}`,
  )

  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to get unallocated members')
  }

  return response.json()
}


/**
 * Submit contract request with expiry date
 */
export async function submitContractRequest(expiryDate: string): Promise<void> {
  const response = await authenticatedFetch(`${API_BASE}/api/users/me/contract-request`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ contract_expiry_date: expiryDate }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to submit contract request')
  }
}

/**
 * Get pending contract requests (committee only)
 */
export async function getPendingContracts(): Promise<PendingContract[]> {
  const response = await authenticatedFetch(`${API_BASE}/api/admin/pending-contracts`)

  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to get pending contracts')
  }

  return response.json()
}

/**
 * Approve a contract (committee only)
 */
export async function approveContract(userId: string): Promise<void> {
  const response = await authenticatedFetch(`${API_BASE}/api/admin/approve-contract/${userId}`, {
    method: 'POST',
  })

  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to approve contract')
  }
}

/**
 * Get events within date range (public endpoint, no auth required)
 */
export async function getEvents(startDate?: string, endDate?: string): Promise<Event[]> {
  const params = new URLSearchParams()
  if (startDate) params.append('start_date', startDate)
  if (endDate) params.append('end_date', endDate)

  const url = `${API_BASE}/api/events${params.toString() ? `?${params.toString()}` : ''}`
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error('Failed to fetch events')
  }

  return response.json()
}

export interface TermWeek {
  summary: string
  start_date: string
  end_date: string
}

/**
 * Get Oxford term weeks (public endpoint, no auth required)
 */
export async function getTermWeeks(): Promise<TermWeek[]> {
  const response = await fetch(`${API_BASE}/api/term-weeks`)

  if (!response.ok) {
    return [] // Non-critical, degrade gracefully
  }

  return response.json()
}


/**
 * Get shift information for date range (authenticated)
 */
export async function getShifts(startDate: string, endDate: string): Promise<ShiftInfo[]> {
  const params = new URLSearchParams()
  params.append('start_date', startDate)
  params.append('end_date', endDate)

  const response = await authenticatedFetch(`${API_BASE}/api/shifts?${params.toString()}`)

  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to fetch shifts')
  }

  return response.json()
}

/**
 * Sign up for a shift (authenticated)
 */
export async function signupForShift(date: string): Promise<void> {
  const response = await authenticatedFetch(`${API_BASE}/api/shifts/${date}/signup`, {
    method: 'POST',
  })

  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to sign up for shift')
  }
}

/**
 * Assign a user to a shift (committee only)
 */
export async function assignUserToShift(date: string, userId: string): Promise<void> {
  const response = await authenticatedFetch(`${API_BASE}/api/admin/shifts/${date}/${userId}`, {
    method: 'POST',
  })

  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to assign user to shift')
  }
}

/**
 * Remove a user from a shift (committee only)
 */
export async function removeUserFromShift(date: string, userId: string): Promise<void> {
  const response = await authenticatedFetch(`${API_BASE}/api/admin/shifts/${date}/${userId}`, {
    method: 'DELETE',
  })

  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to remove user from shift')
  }
}

/**
 * Cancel shift signup (authenticated)
 */
export async function cancelShiftSignup(date: string): Promise<void> {
  const response = await authenticatedFetch(`${API_BASE}/api/shifts/${date}/signup`, {
    method: 'DELETE',
  })

  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to cancel signup')
  }
}

/**
 * Get current user's upcoming shifts (authenticated)
 */
export async function getMyShifts(): Promise<UserShift[]> {
  const response = await authenticatedFetch(`${API_BASE}/api/users/me/shifts`)

  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to fetch your shifts')
  }

  return response.json()
}

/**
 * Get bar hours (committee only)
 */
export async function getBarHours(): Promise<BarHours[]> {
  const response = await authenticatedFetch(`${API_BASE}/api/admin/bar-hours`)

  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to fetch bar hours')
  }

  return response.json()
}

/**
 * Update bar hours for a specific day (committee only)
 */
export async function updateBarHours(dayOfWeek: number, openTime: string, closeTime: string): Promise<void> {
  const response = await authenticatedFetch(`${API_BASE}/api/admin/bar-hours`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      day_of_week: dayOfWeek,
      open_time: openTime,
      close_time: closeTime,
    }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to update bar hours')
  }
}

/**
 * Get overview statistics for committee dashboard
 */
export async function getOverviewStats(): Promise<OverviewStats> {
  const response = await authenticatedFetch(`${API_BASE}/api/admin/overview`)

  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to fetch overview stats')
  }

  return response.json()
}

/**
 * Get user overview for dashboard
 */
export async function getMyOverview(): Promise<UserOverview> {
  const response = await authenticatedFetch(`${API_BASE}/api/users/me/overview`)

  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to fetch user overview')
  }

  return response.json()
}

// ===== Email & Privacy =====

/**
 * Update user email
 */
export async function updateEmail(email: string | null): Promise<void> {
  const response = await authenticatedFetch(`${API_BASE}/api/users/me/email`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to update email')
  }
}

/**
 * Toggle email notifications
 */
export async function updateEmailNotifications(enabled: boolean): Promise<void> {
  const response = await authenticatedFetch(`${API_BASE}/api/users/me/email-notifications`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to update notification settings')
  }
}

/**
 * Accept privacy notice
 */
export async function acceptPrivacy(): Promise<void> {
  const response = await authenticatedFetch(`${API_BASE}/api/users/me/accept-privacy`, {
    method: 'POST',
  })

  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to accept privacy notice')
  }
}

/**
 * Export all user data (GDPR)
 */
export async function exportMyData(): Promise<object> {
  const response = await authenticatedFetch(`${API_BASE}/api/users/me/data`)

  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to export data')
  }

  return response.json()
}

/**
 * Delete own account (GDPR)
 */
export async function deleteMyAccount(): Promise<void> {
  const response = await authenticatedFetch(`${API_BASE}/api/users/me`, {
    method: 'DELETE',
  })

  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to delete account')
  }
}

/**
 * Register with email only (no passkey)
 */
export async function registerWithEmail(displayName: string, email: string): Promise<void> {
  const response = await fetch(`${API_BASE}/api/auth/register/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ display_name: displayName, email }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to register')
  }
}

/**
 * Request magic link login email
 */
export async function requestMagicLink(email: string): Promise<void> {
  const response = await fetch(`${API_BASE}/api/auth/magic-link/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to send magic link')
  }
}

// ===== Stock Management =====

export interface Product {
  id: number
  name: string
  description: string | null
  category: string
  current_stock: number
  last_unit_cost: number | null
  created_at: string
  updated_at: string
}

export interface CreateProductRequest {
  name: string
  description?: string
  category: string
}

/**
 * Get all products with stock levels (committee only)
 */
export async function getProducts(): Promise<Product[]> {
  const response = await authenticatedFetch(`${API_BASE}/api/admin/stock/products`)

  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to fetch products')
  }

  return response.json()
}

/**
 * Create a new product with specified PoS ID (committee only)
 */
export async function createProduct(id: number, product: CreateProductRequest): Promise<Product> {
  const response = await authenticatedFetch(`${API_BASE}/api/admin/stock/products/${id}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(product),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to create product')
  }

  return response.json()
}

/**
 * Look up product by barcode (committee only)
 * Returns product with current stock information
 */
export async function lookupBarcode(barcode: string): Promise<Product> {
  const response = await authenticatedFetch(`${API_BASE}/api/admin/stock/barcode/${barcode}`)

  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Barcode not found')
  }

  return response.json()
}

/**
 * Link a barcode to a product (committee only)
 */
export async function addBarcode(productId: number, barcode: string): Promise<void> {
  const response = await authenticatedFetch(`${API_BASE}/api/admin/stock/products/${productId}/barcodes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ barcode }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to add barcode')
  }
}

export interface StockTransaction {
  product_id: number
  quantity: number  // Positive = add stock, Negative = remove stock
  unit_cost?: number  // Required for positive quantities (purchases), unless it's an adjustment
}

export interface CreateTransactionsRequest {
  transactions: StockTransaction[]
  notes?: string
}

/**
 * Create stock transactions (committee only)
 */
export async function createStockTransactions(request: CreateTransactionsRequest): Promise<void> {
  const response = await authenticatedFetch(`${API_BASE}/api/admin/stock/transactions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to create transactions')
  }
}

// ===== Admin User Management (admin only) =====

/**
 * Get all users (admin only)
 */
export async function getAllUsers(): Promise<UserListItem[]> {
  const response = await authenticatedFetch(`${API_BASE}/api/admin/users`)

  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to fetch users')
  }

  return response.json()
}

/**
 * Promote a user (admin only)
 * user -> committee -> admin
 */
export async function promoteUser(userId: string): Promise<void> {
  const response = await authenticatedFetch(`${API_BASE}/api/admin/users/${userId}/promote`, {
    method: 'POST',
  })

  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to promote user')
  }
}

/**
 * Demote a user (admin only)
 * admin -> committee -> user
 */
export async function demoteUser(userId: string): Promise<void> {
  const response = await authenticatedFetch(`${API_BASE}/api/admin/users/${userId}/demote`, {
    method: 'POST',
  })

  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to demote user')
  }
}

/**
 * Mark a user's code of conduct as signed (admin only)
 */
export async function markCoC(userId: string): Promise<void> {
  const response = await authenticatedFetch(`${API_BASE}/api/admin/users/${userId}/mark-coc`, {
    method: 'POST',
  })

  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to mark code of conduct signed')
  }
}

/**
 * Mark a user's induction as complete (admin only)
 */
export async function markInduction(userId: string): Promise<void> {
  const response = await authenticatedFetch(`${API_BASE}/api/admin/users/${userId}/mark-induction`, {
    method: 'POST',
  })

  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to mark induction complete')
  }
}

/**
 * Delete a user (admin only)
 */
export async function deleteUser(userId: string): Promise<void> {
  const response = await authenticatedFetch(`${API_BASE}/api/admin/users/${userId}`, {
    method: 'DELETE',
  })

  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to delete user')
  }
}

// ===== Bulk Import (admin only) =====

export interface BulkImportUser {
  email: string
  display_name?: string
}

export async function bulkImportUsers(users: BulkImportUser[]): Promise<BulkImportResult> {
  const response = await authenticatedFetch(`${API_BASE}/api/admin/users/bulk-import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ users }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to bulk import users')
  }

  return response.json()
}

// ===== Admin Certificate & Contract =====

export async function adminUploadCertificate(userId: string, file: File): Promise<void> {
  const formData = new FormData()
  formData.append('certificate', file)

  const token = getAuthToken()
  if (!token) throw new AuthError('Not authenticated')

  const response = await fetch(`${API_BASE}/api/admin/users/${userId}/upload-certificate`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: formData,
  })

  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to upload certificate')
  }
}

export async function adminClearContract(userId: string): Promise<void> {
  const response = await authenticatedFetch(`${API_BASE}/api/admin/users/${userId}/clear-contract`, {
    method: 'POST',
  })

  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to clear contract')
  }
}

export async function adminSetContract(userId: string, expiryDate: string): Promise<void> {
  const response = await authenticatedFetch(`${API_BASE}/api/admin/users/${userId}/set-contract`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contract_expiry_date: expiryDate }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to set contract')
  }
}

export async function adminSetEmail(userId: string, email: string): Promise<void> {
  const response = await authenticatedFetch(`${API_BASE}/api/admin/users/${userId}/set-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to set email')
  }
}

// ===== Induction System =====

export async function setInductionAvailability(date: string): Promise<void> {
  const response = await authenticatedFetch(`${API_BASE}/api/shifts/${date}/induction-availability`, {
    method: 'POST',
  })
  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to set induction availability')
  }
}

export async function removeInductionAvailability(date: string): Promise<void> {
  const response = await authenticatedFetch(`${API_BASE}/api/shifts/${date}/induction-availability`, {
    method: 'DELETE',
  })
  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to remove induction availability')
  }
}

export async function getInductionDates(): Promise<InductionDate[]> {
  const response = await authenticatedFetch(`${API_BASE}/api/induction-dates`)
  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to fetch induction dates')
  }
  return response.json()
}

export async function signupForInduction(date: string, fullShift: boolean): Promise<void> {
  const response = await authenticatedFetch(`${API_BASE}/api/shifts/${date}/induction-signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ full_shift: fullShift }),
  })
  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to sign up for induction')
  }
}

export async function cancelInductionSignup(date: string): Promise<void> {
  const response = await authenticatedFetch(`${API_BASE}/api/shifts/${date}/induction-signup`, {
    method: 'DELETE',
  })
  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to cancel induction signup')
  }
}

export async function markSupervisedShift(userId: string): Promise<void> {
  const response = await authenticatedFetch(`${API_BASE}/api/admin/users/${userId}/mark-supervised`, {
    method: 'POST',
  })
  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to mark supervised shift complete')
  }
}

export async function getPendingInductionApprovals(): Promise<PendingInductionApproval[]> {
  const response = await authenticatedFetch(`${API_BASE}/api/admin/pending-inductions`)
  if (!response.ok) {
    const error = await response.json()
    throw new AuthError(error.error || 'Failed to fetch pending induction approvals')
  }
  return response.json()
}

// ===== Passkey Setup (for authenticated users) =====

export async function startPasskeySetup(): Promise<void> {
  // Step 1: Get challenge
  const startResponse = await authenticatedFetch(`${API_BASE}/api/users/me/passkey/start`, {
    method: 'POST',
  })

  if (!startResponse.ok) {
    const error = await startResponse.json()
    throw new AuthError(error.error || 'Failed to start passkey setup')
  }

  const optionsResponse = await startResponse.json()

  // Step 2: Create credential with browser
  const credential = await startRegistration({
    optionsJSON: optionsResponse.publicKey || optionsResponse
  })

  // Step 3: Finish registration
  const finishResponse = await authenticatedFetch(`${API_BASE}/api/users/me/passkey/finish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credential),
  })

  if (!finishResponse.ok) {
    const error = await finishResponse.json()
    throw new AuthError(error.error || 'Failed to finish passkey setup')
  }
}
