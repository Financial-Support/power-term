import classNames from 'classnames'

export default function SideIcon (props) {
  const {
    show,
    className,
    title = '',
    active,
    children,
    onClick
  } = props
  if (show === false) {
    return null
  }
  const cls = classNames(className, 'control-icon-wrap', {
    active
  })

  const handleKeyDown = (e) => {
    // support Enter and Space to activate
    if (!onClick) {
      return
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onClick(e)
    }
  }

  return (
    <div
      className={cls}
      title={title}
      role='button'
      tabIndex={0}
      onClick={onClick}
      onKeyDown={handleKeyDown}
    >
      {/* Icon */}
      {children}
      {/* Text label shown to the right of icon */}
      <span className='control-icon-text'>{title}</span>
    </div>
  )
}
