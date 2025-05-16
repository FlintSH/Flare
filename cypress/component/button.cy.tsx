import { Button } from '@/components/ui/button'

describe('Button Component', () => {
  it('renders correctly with default props', () => {
    // Mount the Button component
    cy.mount(<Button>Click me</Button>)

    // Check that it renders
    cy.get('button').should('exist')
    cy.get('button').should('be.visible')
    cy.get('button').should('have.text', 'Click me')
  })

  it('handles clicks correctly', () => {
    // Create a spy to track clicks
    const onClick = cy.spy().as('clickSpy')

    // Mount the Button with the click handler
    cy.mount(<Button onClick={onClick}>Click me</Button>)

    // Click the button
    cy.get('button').click()

    // Verify the click handler was called
    cy.get('@clickSpy').should('have.been.called')
  })

  it('renders in disabled state', () => {
    // Mount the Button in disabled state
    cy.mount(<Button disabled>Disabled</Button>)

    // Verify it's disabled
    cy.get('button').should('be.disabled')

    // Verify the button text
    cy.get('button').should('have.text', 'Disabled')
  })

  it('renders different variants', () => {
    // Test different variants
    cy.mount(
      <div className="space-x-2">
        <Button variant="default">Default</Button>
        <Button variant="destructive">Destructive</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="link">Link</Button>
      </div>
    )

    // Verify all buttons rendered
    cy.get('button').should('have.length', 6)

    // Verify specific variants
    cy.contains('button', 'Default').should('exist')
    cy.contains('button', 'Destructive').should('exist')
    cy.contains('button', 'Outline').should('exist')
    cy.contains('button', 'Secondary').should('exist')
    cy.contains('button', 'Ghost').should('exist')
    cy.contains('button', 'Link').should('exist')
  })
})
