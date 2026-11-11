import { Link } from 'react-router-dom';

/** Any address that is not a page: said plainly, with a way back, rather than a silent jump to the Dashboard. */
export default function NotFound() {
  return (
    <div className="panel">
      <div className="state">
        <div>This address does not match a page in the portal. Check the link, or start again from the Dashboard.</div>
        <Link className="btn state-action" to="/">
          Go to the Dashboard
        </Link>
      </div>
    </div>
  );
}
