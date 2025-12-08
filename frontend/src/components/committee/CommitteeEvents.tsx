import EventManagement from '../EventManagement'
import { usePageTitle } from '../../hooks/usePageTitle'

export default function CommitteeEvents() {
  usePageTitle('Manage Events')

  return (
    <div>
      <EventManagement />
    </div>
  )
}
