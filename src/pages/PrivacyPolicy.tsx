import { ArrowLeft, Shield } from 'lucide-react';
import { Link } from 'react-router-dom';
import './Legal.css';

export function PrivacyPolicy() {
  return (
    <div className="legal-container container">
      <div className="legal-card glass">
        <div className="legal-header">
          <Link to="/about" className="back-link flex-center">
            <ArrowLeft size={18} />
            <span>Back to About</span>
          </Link>
          <div className="legal-title-wrapper flex-center">
            <Shield size={28} className="legal-icon" />
            <h1 className="legal-title">Privacy Policy</h1>
          </div>
        </div>

        <div className="legal-content">
          <p className="legal-last-updated">Last updated: August 6, 2026</p>

          <section className="legal-section">
            <h2>Overview</h2>
            <p>
              TerraGuard ("we", "us", or "our") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our seismic monitoring dashboard and related services (the "Service").
            </p>
            <p>
              We process earthquake data from third-party providers such as PHIVOLCS and USGS. We do not collect, store, or share any personally identifiable information from those data sources.
            </p>
          </section>

          <section className="legal-section">
            <h2>Information We Collect</h2>
            <ul className="legal-list">
              <li>
                <strong>Account Information:</strong> If you choose to create an account, we may collect your email address and a username.
              </li>
              <li>
                <strong>User Content:</strong> Information you provide when posting on the community forum, bookmarking earthquakes, or interacting with other users.
              </li>
              <li>
                <strong>Usage Data:</strong> We may collect information about how you access and use the Service, such as your IP address, browser type, operating system, and the pages you visit.
              </li>
              <li>
                <strong>Device Information:</strong> Information about the device you use to access the Service, including hardware model, operating system, and unique device identifiers.
              </li>
            </ul>
          </section>

          <section className="legal-section">
            <h2>How We Use Your Information</h2>
            <p>We use the information we collect to:</p>
            <ul className="legal-list">
              <li>Provide, operate, and maintain the Service</li>
              <li>Improve, personalize, and expand the Service</li>
              <li>Understand and analyze how you use the Service</li>
              <li>Develop new features and functionality</li>
              <li>Respond to your questions and support requests</li>
              <li>Send you notifications related to your account or the Service</li>
              <li>Monitor and prevent fraudulent activity and abuse</li>
            </ul>
          </section>

          <section className="legal-section">
            <h2>Sharing Your Information</h2>
            <p>
              We do not sell, trade, or otherwise transfer your personally identifiable information to outside parties. This does not apply to trusted third parties who assist us in operating our Service, conducting our business, or serving our users, provided those parties agree to keep your information confidential.
            </p>
            <p>
              We may also share information to comply with the law, respond to lawful governmental requests, or to protect the rights, property, or safety of ourselves or others.
            </p>
          </section>

          <section className="legal-section">
            <h2>Third-Party Services</h2>
            <p>
              The Service may contain links to other websites or services that are not operated by us. We strongly advise you to review the privacy policy of every site you visit. We have no control over and assume no responsibility for the content, privacy policies, or practices of any third-party sites or services.
            </p>
            <p>
              Earthquake data is sourced from PHIVOLCS and USGS. See their respective privacy policies for information about how they handle data.
            </p>
          </section>

          <section className="legal-section">
            <h2>Data Retention</h2>
            <p>
              We retain information for as long as necessary to provide the Service and fulfill the purposes described in this Privacy Policy, unless a longer retention period is required or permitted by law. If you request deletion of your account, we will delete your personal data within a reasonable timeframe.
            </p>
          </section>

          <section className="legal-section">
            <h2>Security</h2>
            <p>
              We take reasonable measures to protect the security of your information. However, please be aware that no method of transmission over the internet or electronic storage is completely secure, and we cannot guarantee absolute security.
            </p>
          </section>

          <section className="legal-section">
            <h2>Your Rights</h2>
            <p>
              Depending on your location, you may have certain rights regarding your personal data, including the right to access, rectify, delete, restrict, or object to processing, and the right to data portability. You may also have the right to withdraw your consent at any time.
            </p>
          </section>

          <section className="legal-section">
            <h2>Children's Privacy</h2>
            <p>
              The Service is not intended for individuals under the age of 13. We do not knowingly collect personal information from children under 13. If we become aware that we have collected personal information from a child under 13, we will take steps to delete that information.
            </p>
          </section>

          <section className="legal-section">
            <h2>Changes to This Privacy Policy</h2>
            <p>
              We may update our Privacy Policy from time to time. We will post any changes on this page and, if the change is significant, we will notify you by email or through the Service. The "Last updated" date at the top of this policy indicates when the most recent revision occurred.
            </p>
          </section>

          <section className="legal-section">
            <h2>Contact Us</h2>
            <p>
              If you have any questions about this Privacy Policy, please contact us through the support channels made available in the Service.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
