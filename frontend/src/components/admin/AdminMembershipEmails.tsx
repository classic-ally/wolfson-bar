import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  getEmailTemplates,
  getOnboardingSettings,
  getTrainingLinks,
  previewEmailTemplate,
  putEmailTemplate,
  putOnboardingSettings,
  putTrainingLinks,
  sendTestEmailTemplate,
} from '../../lib/auth'
import type { EmailTemplate } from '../../types/EmailTemplate'
import type { OnboardingSettings } from '../../types/OnboardingSettings'
import type { RenderedEmail } from '../../types/RenderedEmail'
import type { TemplateKey } from '../../types/TemplateKey'
import type { TrainingLink } from '../../types/TrainingLink'
import { usePageTitle } from '../../hooks/usePageTitle'

const card = 'rounded-lg bg-white p-5 shadow-sm'

const TEMPLATE_INFO: Record<TemplateKey, { title: string; when: (s: OnboardingSettings | null) => string }> = {
  post_induction: {
    title: 'After induction',
    when: (s) =>
      `The morning after a member is inducted, once at least ${s?.post_induction_delay_hours ?? 6} hours have passed.`,
  },
  ready_to_book: {
    title: 'Ready to book',
    when: () => 'When a member can sign up for shifts but still needs their supervised shift.',
  },
  welcome_to_rota: {
    title: 'Welcome to the rota',
    when: () => 'When a member completes their supervised shift and is a full rota member.',
  },
  stuck_reminder: {
    title: 'Stuck reminder',
    when: (s) =>
      s?.stuck_reminder_days == null
        ? "Sent automatically: off. Committee members can still send it from the Onboarding page."
        : `${s.stuck_reminder_days} days after induction if steps are still missing. Committee members can also send it from the Onboarding page.`,
  },
  coc_resign: {
    title: 'Re-sign the Code of Conduct',
    when: () => 'After a new Code of Conduct is published, to members who signed an earlier version.',
  },
}

const PLACEHOLDERS: { name: string; description: string }[] = [
  { name: 'name', description: "The member's display name. The only placeholder allowed in the subject." },
  { name: 'next_steps', description: 'A checklist of their onboarding steps, ticked or with what to do next. Put it on its own line.' },
  { name: 'food_safety_links', description: 'The training links below, as a list. Put it on its own line.' },
  { name: 'onboarding_url', description: 'Their onboarding checklist page.' },
  { name: 'calendar_url', description: 'The shift calendar.' },
]

function TemplatesSection({ settings }: { settings: OnboardingSettings | null }) {
  const [templates, setTemplates] = useState<EmailTemplate[]>([])
  const [selected, setSelected] = useState<TemplateKey>('post_induction')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [preview, setPreview] = useState<RenderedEmail | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    try {
      setTemplates(await getEmailTemplates())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load email templates')
    }
  }

  useEffect(() => {
    load()
  }, [])

  const current = templates.find((t) => t.key === selected)

  useEffect(() => {
    if (current) {
      setSubject(current.subject)
      setBody(current.body)
    }
    // Reset the editor only when switching templates or after a reload.
  }, [selected, templates]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!subject.trim() || !body.trim()) return
    const timer = setTimeout(async () => {
      try {
        setPreview(await previewEmailTemplate(selected, { subject, body }))
        setPreviewError(null)
      } catch (e) {
        setPreviewError(e instanceof Error ? e.message : 'Failed to preview email')
      }
    }, 400)
    return () => clearTimeout(timer)
  }, [selected, subject, body])

  const unchanged = !!current && subject === current.subject && body === current.body

  const run = async (action: () => Promise<void>, success: string) => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await action()
      setNotice(success)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={card}>
      <h2 className="mt-0 mb-2 text-lg font-semibold">Emails</h2>
      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Email templates">
        {(Object.keys(TEMPLATE_INFO) as TemplateKey[]).map((key) => (
          <Button
            key={key}
            role="tab"
            aria-selected={key === selected}
            variant={key === selected ? 'default' : 'outline'}
            size="sm"
            onClick={() => {
              setSelected(key)
              setNotice(null)
              setError(null)
            }}
          >
            {TEMPLATE_INFO[key].title}
          </Button>
        ))}
      </div>
      <p className="mb-1 text-sm">
        <strong>When it's sent:</strong> {TEMPLATE_INFO[selected].when(settings)}
      </p>
      {current && (
        <p className="mb-4 text-xs text-muted-foreground">
          Last edited {current.updated_at} UTC{current.updated_by_name ? ` by ${current.updated_by_name}` : ''}
        </p>
      )}

      {notice && (
        <p role="status" className="mb-3 rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-900">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="mb-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-3">
          <label className="block text-sm font-medium">
            Subject
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} className="mt-1" />
          </label>
          <label className="block text-sm font-medium">
            Body <span className="font-normal text-muted-foreground">(Markdown)</span>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={20}
              className="mt-1 font-mono text-sm"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy || unchanged}
              onClick={() =>
                run(async () => {
                  await putEmailTemplate(selected, { subject, body })
                  await load()
                }, 'Saved.')
              }
            >
              Save
            </Button>
            <Button
              variant="outline"
              disabled={busy || unchanged}
              onClick={() => {
                if (!current) return
                setSubject(current.subject)
                setBody(current.body)
              }}
            >
              Discard changes
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                run(() => sendTestEmailTemplate(selected, { subject, body }), 'Test email sent to your address.')
              }
            >
              Send a test to me
            </Button>
          </div>
          <details className="text-sm">
            <summary className="cursor-pointer font-medium">Placeholders</summary>
            <dl className="mt-2 space-y-1">
              {PLACEHOLDERS.map((p) => (
                <div key={p.name}>
                  <dt className="inline font-mono">{`{{${p.name}}}`}</dt>
                  <dd className="inline text-muted-foreground"> — {p.description}</dd>
                </div>
              ))}
            </dl>
          </details>
        </div>

        <div>
          <h3 className="mt-0 mb-1 text-sm font-medium">Preview, for an example member partway through</h3>
          {previewError ? (
            <p role="alert" className="text-sm text-destructive">
              {previewError}
            </p>
          ) : (
            preview && (
              <div className="rounded-md border border-border">
                <p className="m-0 border-b border-border bg-muted/30 px-3 py-2 text-sm">
                  <strong>Subject:</strong> {preview.subject}
                </p>
                <iframe
                  title="Email preview"
                  srcDoc={preview.html}
                  sandbox=""
                  className="h-[34rem] w-full bg-white"
                />
              </div>
            )
          )}
        </div>
      </div>
    </section>
  )
}

function TrainingLinksSection() {
  const [links, setLinks] = useState<TrainingLink[]>([])
  const [saved, setSaved] = useState<TrainingLink[]>([])
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getTrainingLinks()
      .then((l) => {
        setLinks(l)
        setSaved(l)
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load training links'))
  }, [])

  const update = (i: number, change: Partial<TrainingLink>) => {
    setNotice(null)
    setLinks((ls) => ls.map((l, j) => (j === i ? { ...l, ...change } : l)))
  }

  const move = (i: number, by: number) => {
    setNotice(null)
    setLinks((ls) => {
      const next = [...ls]
      ;[next[i], next[i + by]] = [next[i + by], next[i]]
      return next
    })
  }

  const unchanged = JSON.stringify(links) === JSON.stringify(saved)

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      await putTrainingLinks(links)
      setSaved(links)
      setNotice('Saved.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save training links')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={card}>
      <h2 className="mt-0 mb-2 text-lg font-semibold">Food safety training links</h2>
      <p className="mb-3 text-sm text-muted-foreground">
        Shown on every member's onboarding checklist and inserted into emails with{' '}
        <code>{'{{food_safety_links}}'}</code>.
      </p>
      {notice && (
        <p role="status" className="mb-3 rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-900">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="mb-3 text-sm text-destructive">
          {error}
        </p>
      )}
      <ul className="m-0 list-none space-y-2 p-0">
        {links.map((link, i) => (
          <li key={i} className="flex flex-wrap items-center gap-2">
            <Input
              aria-label={`Link ${i + 1} label`}
              placeholder="Label"
              value={link.label}
              onChange={(e) => update(i, { label: e.target.value })}
              className="min-w-0 flex-[1_1_12rem]"
            />
            <Input
              aria-label={`Link ${i + 1} address`}
              placeholder="https://"
              value={link.url}
              onChange={(e) => update(i, { url: e.target.value })}
              className="min-w-0 flex-[2_1_16rem]"
            />
            <div className="flex gap-1">
              <Button variant="outline" size="sm" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                ↑
              </Button>
              <Button
                variant="outline"
                size="sm"
                aria-label="Move down"
                disabled={i === links.length - 1}
                onClick={() => move(i, 1)}
              >
                ↓
              </Button>
              <Button
                variant="outline"
                size="sm"
                aria-label="Remove"
                onClick={() => {
                  setNotice(null)
                  setLinks((ls) => ls.filter((_, j) => j !== i))
                }}
              >
                ✕
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => setLinks((ls) => [...ls, { label: '', url: '' }])}>
          Add link
        </Button>
        <Button onClick={save} disabled={busy || unchanged}>
          Save links
        </Button>
      </div>
    </section>
  )
}

function ScheduleSection({
  settings,
  onSaved,
}: {
  settings: OnboardingSettings | null
  onSaved: (s: OnboardingSettings) => void
}) {
  const [delay, setDelay] = useState('6')
  const [reminderOn, setReminderOn] = useState(true)
  const [reminderDays, setReminderDays] = useState('7')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!settings) return
    setDelay(String(settings.post_induction_delay_hours))
    setReminderOn(settings.stuck_reminder_days !== null)
    setReminderDays(String(settings.stuck_reminder_days ?? 7))
  }, [settings])

  const save = async () => {
    const next: OnboardingSettings = {
      post_induction_delay_hours: Number(delay),
      stuck_reminder_days: reminderOn ? Number(reminderDays) : null,
    }
    setBusy(true)
    setError(null)
    try {
      await putOnboardingSettings(next)
      onSaved(next)
      setNotice('Saved.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save email settings')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={card}>
      <h2 className="mt-0 mb-2 text-lg font-semibold">Schedule</h2>
      <p className="mb-3 text-sm text-muted-foreground">
        Emails go out once a day, in the morning, to members with Membership emails turned on. Each one is sent at
        most once per member.
      </p>
      {notice && (
        <p role="status" className="mb-3 rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-900">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="mb-3 text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="space-y-3 text-sm">
        <label className="flex flex-wrap items-center gap-2">
          Wait at least
          <Input
            type="number"
            min={0}
            max={168}
            value={delay}
            onChange={(e) => {
              setDelay(e.target.value)
              setNotice(null)
            }}
            className="w-20"
          />
          hours after induction before the "After induction" email, so a mistaken induction can be undone.
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={reminderOn}
              onChange={(e) => {
                setReminderOn(e.target.checked)
                setNotice(null)
              }}
            />
            Send an automatic stuck reminder
          </label>
          <Input
            type="number"
            min={1}
            max={365}
            aria-label="Days after induction"
            value={reminderDays}
            disabled={!reminderOn}
            onChange={(e) => {
              setReminderDays(e.target.value)
              setNotice(null)
            }}
            className="w-20"
          />
          days after induction
        </div>
        <Button onClick={save} disabled={busy || !settings}>
          Save schedule
        </Button>
      </div>
    </section>
  )
}

export default function AdminMembershipEmails() {
  const [settings, setSettings] = useState<OnboardingSettings | null>(null)
  usePageTitle('Membership emails')

  useEffect(() => {
    getOnboardingSettings().then(setSettings).catch(() => {})
  }, [])

  return (
    <div className="space-y-5">
      <div>
        <h1 className="mb-2">Membership emails</h1>
        <p className="text-muted-foreground">
          Automatic emails that guide new members through onboarding, and ask everyone to re-sign a new Code of
          Conduct. Members can turn these off under Membership in their account settings.
        </p>
      </div>
      <TemplatesSection settings={settings} />
      <div className="grid gap-5 lg:grid-cols-2">
        <TrainingLinksSection />
        <ScheduleSection settings={settings} onSaved={setSettings} />
      </div>
    </div>
  )
}
