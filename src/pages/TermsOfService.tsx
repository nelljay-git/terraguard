import { ArrowLeft, FileText } from 'lucide-react';
import { Link } from 'react-router-dom';
import './Legal.css';

export function TermsOfService() {
  return (
    <div className="legal-container container">
      <div className="legal-card glass">
        <div className="legal-header">
          <Link to="/about" className="back-link flex-center">
            <ArrowLeft size={18} />
            <span>Back to About</span>
          </Link>
          <div className="legal-title-wrapper flex-center">
            <FileText size={28} className="legal-icon" />
            <h1 className="legal-title">Terms of Service</h1>
          </div>
        </div>

        <div className="legal-content">
          <p className="legal-last-updated">Last updated: August 6, 2026</p>

          <section className="legal-section">
            <h2>Agreement to Terms</h2>
            <p>
              These Terms of Service ("Terms") constitute a binding agreement between you ("you") and TerraGuard ("we", "us", or "our") governing your access to and use of the TerraGuard seismic monitoring dashboard, website, mobile application, and related services (collectively, the "Service").
            </p>
            <p>
              By accessing or using the Service, you agree to be bound by these Terms. If you do not agree with any part of these Terms, you may not use the Service. We recommend that you read these Terms carefully before using the Service.
            </p>
          </section>

          <section className="legal-section">
            <h2>Changes to Terms</h2>
            <p>
              We may update these Terms from time to time. We will post any changes on this page and revise the "Last updated" date. Your continued use of the Service after any changes constitutes your acceptance of the new Terms.
            </p>
          </section>

          <section className="legal-section">
            <h2>Use of the Service</h2>
            <p>
              Subject to these Terms, the Service is provided for personal, non-commercial use. You agree to use the Service only for lawful purposes and in a way that does not infringe the rights of others or restrict their use.
            </p>
            <p>
              You are responsible for maintaining the confidentiality of your account credentials and for all activities that occur under your account. If you suspect unauthorized access, please notify us immediately.
            </p>
          </section>

          <section className="legal-section">
            <h2>Eligibility</h2>
            <p>
              You must be at least 13 years old to use the Service. By using the Service, you represent and warrant that you meet this eligibility requirement. If you are under 18, you may use the Service only with the involvement of a parent or guardian who agrees to these Terms.
            </p>
          </section>

          <section className="legal-section">
            <h2>Prohibited Activities</h2>
            <p>You agree not to:</p>
            <ul className="legal-list">
              <li>Violate any law, regulation, or third-party right</li>
              <li>Use the Service in any manner that could damage, disable, or impair the Service</li>
              <li>Attempt to gain unauthorized access to the Service or related systems</li>
              <li>Engage in conduct that may harm or interfere with other users</li>
              <li>Post content that is defamatory, obscene, or otherwise objectionable</li>
              <li>Spam, harass, or send unsolicited communications</li>
              <li>Use automated systems (e.g., bots, scrapers) to access the Service without authorization</li>
              <li>Collect or harvest user data without consent</li>
            </ul>
          </section>

          <section className="legal-section">
            <h2>Intellectual Property</h2>
            <p>
              The Service and all content, features, and functionality are owned by TerraGuard and are protected by copyright, trademark, and other intellectual property laws. These Terms do not grant you any rights to use our trademarks, service marks, or other intellectual property without our prior written consent.
            </p>
            <p>
              Earthquake data sourced from PHIVOLCS and USGS remains the property of those respective organizations.
            </p>
          </section>

          <section className="legal-section">
            <h2>User Content</h2>
            <p>
              You retain ownership of any content you submit to the Service (such as forum posts, comments, etc.). By submitting content, you grant us a non-exclusive, worldwide, royalty-free, sublicensable license to use, reproduce, modify, publicly display, and distribute that content in connection with the Service.
            </p>
            <p>
              You represent that you have the right to submit the content and that it does not violate these Terms or the rights of others.
            </p>
          </section>

          <section className="legal-section">
            <h2>Third-Party Services</h2>
            <p>
              The Service may contain links to third-party websites or services. We do not control and assume responsibility for the content, privacy policies, or practices of any third-party sites or services. You acknowledge and agree that we are not liable for any damage or loss caused by reliance on third-party services.
            </p>
          </section>

          <section className="legal-section">
            <h2>Disclaimer of Warranties</h2>
            <p>
              THE SERVICE IS PROVIDED ON AN "AS IS" AND "AS AVAILABLE" BASIS WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED. WE DISCLAIM ALL WARRANTIES, INCLUDING BUT NOT LIMITED TO THE IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.
            </p>
            <p>
              WE DO NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, SECURE, OR ERROR-FREE, OR THAT DEFECTS WILL BE CORRECTED. YOU ACKNOWLEDGE THAT SEISMIC DATA IS PROVIDED "AS IS" AND SHOULD NOT BE USED AS THE SOLE BASIS FOR LIFE-SAVING DECISIONS. ALWAYS CONSULT OFFICIAL GOVERNMENT SOURCES FOR CRITICAL INFORMATION.
            </p>
          </section>

          <section className="legal-section">
            <h2>Limitation of Liability</h2>
            <p>
              TO THE MAXIMUM EXTENT PERMITTED BY LAW, NEITHER TERRAGUARD NOR ITS AFFILIATES SHALL BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF DATA, PROFITS, REVENUE, OR BUSINESS INTERRUPTION RESULTING FROM YOUR USE OF THE SERVICE.
            </p>
            <p>
              OUR TOTAL LIABILITY TO YOU FOR ANY CLAIM ARISING OUT OF OR IN CONNECTION WITH THESE TERMS OR THE SERVICE WILL NOT EXCEED THE AMOUNT PAID, IF ANY, BY YOU FOR THE SERVICE IN THE 12 MONTHS PRECEDING THE CLAIM. THIS LIMITATION WILL APPLY REGARDLESS OF THE THEORY OF LIABILITY.
            </p>
          </section>

          <section className="legal-section">
            <h2>Indemnification</h2>
            <p>
              You agree to defend, indemnify, and hold harmless TerraGuard, its affiliates, and their respective officers, directors, employees, and agents from and against any claims, liabilities, damages, losses, or expenses arising out of or in connection with your breach of these Terms or your violation of any law or third-party right.
            </p>
          </section>

          <section className="legal-section">
            <h2>Governing Law</h2>
            <p>
              These Terms are governed by the laws of the Philippines, without regard to its conflict of law principles. Any dispute arising out of or in connection with these Terms will be subject to the exclusive jurisdiction of the courts of the Philippines.
            </p>
          </section>

          <section className="legal-section">
            <h2>Miscellaneous</h2>
            <p>
              These Terms, together with our Privacy Policy, constitute the entire agreement between you and TerraGuard regarding the Service. If any provision is found invalid, the remaining provisions will remain in full force. Our failure to enforce any right or provision will not be deemed a waiver of such right or provision.
            </p>
          </section>

          <section className="legal-section">
            <h2>Contact Us</h2>
            <p>
              If you have any questions about these Terms of Service, please contact us through the support channels provided in the Service.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
