import icon from "../../Assets/Images/pharaoh-icon.png";

/**
 * Shared shell for the auth pages: the split card with the brand panel on
 * one side and the caller's form (`children`) on the other.
 */
const AuthCard = ({ title, sub, children }) => (
  <div className="auth-page">
    <div className="auth-card">
      <div className="auth-brand">
        <img src={icon} alt="" className="auth-brand-icon" />
        <h1 className="auth-brand-title">{title}</h1>
        <p className="auth-brand-sub">{sub}</p>
      </div>
      {children}
    </div>
  </div>
);

export default AuthCard;
