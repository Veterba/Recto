/** A named group of settings. One heading, one hairline, no accordion. */
export function SettingGroup({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <section className="settings__group">
      <h3 className="settings__grouphead">{title}</h3>
      {children}
    </section>
  )
}
