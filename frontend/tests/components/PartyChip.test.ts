import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import PartyChip from '../../app/components/PartyChip.vue';
import { partyColors } from '../../shared/misc';

describe('PartyChip', () => {
    it('renders party name', () => {
        const wrapper = mount(PartyChip, {
            props: {
                party: 'PiS'
            }
        });
        
        expect(wrapper.text()).toContain('PiS');
    });

    it('applies correct background color', () => {
        const wrapper = mount(PartyChip, {
            props: {
                party: 'PO'
            }
        });
        
        const span = wrapper.find('span');
        // Check style. The component uses :style with backgroundColor.
        // jsdom/happy-dom handles style somewhat.
        expect(span.attributes('style')).toContain('background-color: ' + partyColors['PO'].replace(/,/g, ', ')); // hex value usually
        // partyColors['PO'] is #fca241.
        // attributes('style') usually returns string like "background-color: rgb(...);" or hex.
        // Let's match hex or check simple containment.
    });
});
